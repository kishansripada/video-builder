const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const util = require('util');
const { exec } = require('child_process');
const { generateScreenshot } = require('./reddit-image-generator');
const { createClient } = require("@supabase/supabase-js")
const execAsync = util.promisify(exec);
const express = require('express')
const app = express()



class VideoProcessor {
    constructor() {
        this.tempFiles = [];
    }

    async createTempFile(prefix) {
        const tempPath = path.join(os.tmpdir(), `${prefix}_${Date.now()}.mp4`);
        this.tempFiles.push(tempPath);
        return tempPath;
    }

    async cleanup() {
        for (const file of this.tempFiles) {
            try {
                await fs.unlink(file);
            } catch (err) {
                console.error(`Error deleting temp file ${file}:`, err);
            }
        }
        this.tempFiles = [];
    }

    getAudioDuration(audioPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(metadata.format.duration);
                }
            });
        });
    }

    async trimVideo(inputPath, duration) {
        const outputPath = await this.createTempFile('trimmed');
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .setDuration(duration)
                .output(outputPath)
                .on('end', () => {
                    console.log('Video trimmed');
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('Error trimming video:', err);
                    reject(err);
                })
                .run();
        });
    }

    async removeAudio(inputPath) {
        const outputPath = await this.createTempFile('noaudio');
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .noAudio()
                .output(outputPath)
                .on('end', () => {
                    console.log('Audio removed');
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('Error removing audio:', err);
                    reject(err);
                })
                .run();
        });
    }


    async applyOverlay(inputPath, imageBuffer) {
        const outputPath = await this.createTempFile('withoverlay');
        const tempImagePath = await this.createTempFile('overlay');

        // Write the image buffer to a temporary file
        await fs.writeFile(tempImagePath, imageBuffer);

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .input(tempImagePath)
                .complexFilter([
                    {
                        filter: 'overlay',
                        options: {
                            x: '(W-w)/2',
                            y: '(H-h)/2',
                            enable: 'between(t,0,4)'
                        }
                    }
                ])
                .output(outputPath)
                .on('end', () => {
                    console.log('Overlay applied');
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('Error applying overlay:', err);
                    reject(err);
                })
                .run();
        });
    }

    async applyAudio(inputPath, dingAudioPath, vocalsAudioPath, outputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .input(dingAudioPath)
                .input(vocalsAudioPath)
                .complexFilter([
                    {
                        filter: 'amix',
                        options: {
                            inputs: 2,
                            duration: 'longest'
                        }
                    }
                ])
                .output(outputPath)
                .on('end', () => {
                    console.log('Audio applied');
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('Error applying audio:', err);
                    reject(err);
                })
                .run();
        });
    }

    escapeText(text) {
        return text.replace(/'/g, "'\\''").replace(/:/g, '\\:');
    }

    async generateFilterComplex(subtitlesFile) {
        const data = await fs.readFile(subtitlesFile, 'utf8');
        const words = JSON.parse(data);

        const subtitles = words.map(({ word, startTime, endTime }) => {
            if (startTime !== undefined && endTime !== undefined) {
                return `drawtext=fontfile='Bangers-Regular.ttf':text='${this.escapeText(word)}':fontsize=60:fontcolor=0xFAE54D:borderw=4:bordercolor=black:x=(w-tw)/2:y=(h-th)/2:enable='between(t,${startTime},${endTime})'`;
            }
            return null;
        }).filter(Boolean);

        return subtitles.join(',');
    }

    async burnSubtitles(inputPath, outputPath, subtitlesFile) {
        try {
            const filterComplex = await this.generateFilterComplex(subtitlesFile);
            const ffmpegCommand = `ffmpeg -i ${inputPath} -vf "${filterComplex}" -c:a copy ${outputPath}`;

            const { stderr } = await execAsync(ffmpegCommand);
            if (stderr) {
                console.error(`FFmpeg stderr: ${stderr}`);
            }
            console.log('Subtitles burned successfully!');
            return outputPath;
        } catch (error) {
            console.error('Error burning subtitles:', error);
            throw error;
        }
    }
}
async function processVideoWithOverlayAndAudio(inputPath, outputPath, storyName, dingAudioPath, vocalsAudioPath, subtitlesFile = null) {
    const processor = new VideoProcessor();

    try {
        const duration = await processor.getAudioDuration(vocalsAudioPath);
        console.log(`Vocals duration: ${duration} seconds`);

        const trimmedPath = await processor.trimVideo(inputPath, duration);
        const noAudioPath = await processor.removeAudio(trimmedPath);

        let withSubtitlesPath = noAudioPath;
        if (subtitlesFile) {
            withSubtitlesPath = await processor.createTempFile('with_subtitles');
            await processor.burnSubtitles(noAudioPath, withSubtitlesPath, subtitlesFile);
        }

        // Generate the screenshot buffer
        const imageBuffer = await generateScreenshot(storyName, 75, 80);

        const withOverlayPath = await processor.applyOverlay(withSubtitlesPath, imageBuffer);
        const withAudioPath = await processor.applyAudio(withOverlayPath, dingAudioPath, vocalsAudioPath, outputPath);


        const supabase = createClient(
            "https://dxtxbxkkvoslcrsxbfai.supabase.co",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4dHhieGtrdm9zbGNyc3hiZmFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY2MTQ2Mzc0NiwiZXhwIjoxOTc3MDM5NzQ2fQ.1Sbj1t90pvU2JveRQj0YvCGddbo5ojph-SBcPtGgNDo"
        );
        // Read the file

        const fileBuffer = await fs.readFile(withAudioPath);

        // Generate a unique filename
        const filename = `video_${Date.now()}.mp4`;

        // Upload to Supabase
        const { data, error } = await supabase.storage
            .from('videos')
            .upload(filename, fileBuffer, {
                contentType: 'video/mp4'
            });

        console.log('Video processing completed successfully');
    } catch (error) {
        console.error('Video processing failed:', error);
        throw error;
    } finally {
        await processor.cleanup();
    }
}
// Example usage
const inputVideo = path.join(__dirname, 'background_video.mp4');
const outputVideo = path.join(__dirname, 'output_with_overlay_audio_and_subs.mp4');
const dingAudioFile = path.join(__dirname, 'ding.mp3');
const vocalsAudioFile = path.join(__dirname, 'stitched_audio.mp3');
const subtitlesFile = path.join(__dirname, 'merged_timestamps.json');

async function main() {
    try {
        await processVideoWithOverlayAndAudio(inputVideo, outputVideo, "ER doctors of reddit, what's the worse thing you've ever seen in an operating room?", dingAudioFile, vocalsAudioFile, subtitlesFile);
    } catch (err) {
        console.error('Main process failed:', err);
    }
}

app.get('/', async function (req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/html',
        'Transfer-Encoding': 'chunked'
    });

    res.write('Loading...');

    try {
        await main();
        res.write('<br>Done');
    } catch (error) {
        res.write('<br>Error occurred');
    }

    res.end();
});


app.listen(5555)

