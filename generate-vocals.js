const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const os = require('os');



const VOICE_ID = "21m00Tcm4TlvDq8ikWAM";  // Rachel
const YOUR_XI_API_KEY = "sk_556ad3503877e7f8d9cf388bcb5cc767542f19209d8bfd88";

const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`;

const story = {
    "prompt": "What's the most fucked up thing you discovered about your 'perfect' family member?",
    "body": "My uncle Tom was the golden child of our family. Successful lawyer, beautiful wife, two kids, volunteer firefighter. But I always got weird vibes from him.\n\nLast Thanksgiving, I got hammered and decided to snoop in his study. In the back of a drawer, I found a burner phone. Curiosity piqued, I cracked it open.\n\nHoly shit. It was full of texts arranging meetups with prostitutes."
}

async function textToSpeechWithTimestamps(inputText) {
    const headers = {
        "Content-Type": "application/json",
        "xi-api-key": YOUR_XI_API_KEY
    };

    const data = {
        text: inputText,
        model_id: "eleven_turbo_v2",
        voice: "Will",
        voice_settings: {
            stability: 1,
            similarity_boost: 1
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();

        // Extract the audio data
        const audioBuffer = Buffer.from(responseData.audio_base64, 'base64');

        // Process timestamps
        const timestamps = processTimestamps(responseData.alignment);

        return {
            audio: audioBuffer,
            timestamps: timestamps
        };
    } catch (error) {
        console.error('Error:', error.message);
        throw error;
    }
}

function processTimestamps(alignment) {
    let output = [];
    let currentWord = "";
    let startTime = 0;

    for (let i = 0; i < alignment.characters.length; i++) {
        const char = alignment.characters[i];
        const startTimeSeconds = alignment.character_start_times_seconds[i];
        const endTimeSeconds = alignment.character_end_times_seconds[i];

        if (char === ' ' || i === alignment.characters.length - 1) {
            if (currentWord) {
                output.push({
                    word: currentWord,
                    startTime: parseFloat(startTime.toFixed(3)),
                    endTime: parseFloat(endTimeSeconds.toFixed(3))
                });
                currentWord = "";
            }
            startTime = endTimeSeconds;
        } else {
            if (!currentWord) {
                startTime = startTimeSeconds;
            }
            currentWord += char;
        }
    }

    return output;
}

async function stitchAudioAndMergeTimestamps(promptAudio, bodyAudio, promptTimestamps, bodyTimestamps, outputAudioFile, outputTimestampsFile) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-'));
    const promptAudioPath = path.join(tempDir, 'prompt.mp3');
    const bodyAudioPath = path.join(tempDir, 'body.mp3');
    const silenceFilePath = path.join(tempDir, 'silence.mp3');

    console.log('Saving audio buffers to temporary files...');
    await fs.writeFile(promptAudioPath, promptAudio);
    await fs.writeFile(bodyAudioPath, bodyAudio);

    console.log('Creating silence file...');
    await execPromise(`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.5 -q:a 9 -acodec libmp3lame "${silenceFilePath}"`);

    const tempList = path.join(tempDir, 'temp_list.txt');
    await fs.writeFile(tempList, `file '${promptAudioPath}'\nfile '${silenceFilePath}'\nfile '${bodyAudioPath}'`);

    try {
        console.log('Stitching audio files...');
        const ffmpegCommand = `ffmpeg -f concat -safe 0 -i "${tempList}" -c copy -y "${outputAudioFile}"`;
        console.log(`Executing command: ${ffmpegCommand}`);
        const { stdout, stderr } = await execPromise(ffmpegCommand);
        console.log('FFmpeg stdout:', stdout);
        console.log('FFmpeg stderr:', stderr);

        console.log('Verifying output file...');
        const stats = await fs.stat(outputAudioFile);
        console.log(`Output file size: ${stats.size} bytes`);

        console.log('Merging timestamps...');
        const lastPromptEndTime = promptTimestamps[promptTimestamps.length - 1].endTime;
        const mergedTimestamps = [
            ...promptTimestamps,
            ...bodyTimestamps.map(stamp => ({
                word: stamp.word,
                startTime: stamp.startTime + lastPromptEndTime + 0.5,
                endTime: stamp.endTime + lastPromptEndTime + 0.5
            }))
        ].map(line => {
            return {
                ...line, word: line.word.replace(/\n{2,}/g, ' ').replace(/\n/g, '')
            }
        });

        await fs.writeFile(outputTimestampsFile, JSON.stringify(mergedTimestamps, null, 2));
        console.log('Timestamps merged and saved.');
    } catch (error) {
        console.error('Error during audio processing:', error);
        throw error;
    } finally {
        console.log('Cleaning up temporary files...');
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function main() {
    const { audio: promptAudio, timestamps: promptTimestamps } = await textToSpeechWithTimestamps(story.prompt);
    const { audio: bodyAudio, timestamps: bodyTimestamps } = await textToSpeechWithTimestamps(story.body);

    const outputAudioFile = path.join(process.cwd(), 'stitched_audio.mp3');
    const outputTimestampsFile = path.join(process.cwd(), 'merged_timestamps.json');

    await stitchAudioAndMergeTimestamps(
        promptAudio,
        bodyAudio,
        promptTimestamps,
        bodyTimestamps,
        outputAudioFile,
        outputTimestampsFile
    );

    console.log(`Stitched audio saved to: ${outputAudioFile}`);
    console.log(`Merged timestamps saved to: ${outputTimestampsFile}`);
}

main().catch(console.error);