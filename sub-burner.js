const fs = require('fs');
const { exec } = require('child_process');

const inputVideo = 'output_with_overlay_and_audio.mp4';
const outputVideo = 'withsubs.mp4';
const subtitlesFile = 'words_and_timestamps.json';

// Function to escape special characters in the text
function escapeText(text) {
    return text.replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

// Read JSON and generate FFmpeg filter complex
function generateFilterComplex() {
    return new Promise((resolve, reject) => {
        fs.readFile(subtitlesFile, 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }

            const subtitles = [];
            const words = JSON.parse(data);

            words.forEach(({ word, startTime, endTime }) => {
                if (startTime !== undefined && endTime !== undefined) {
                    subtitles.push(`drawtext=fontfile='Bangers-Regular.ttf':text='${escapeText(word)}':fontsize=60:fontcolor=0xFAE54D:borderw=4:bordercolor=black:x=(w-tw)/2:y=(h-th)/2:enable='between(t,${startTime},${endTime})'`);
                }
            });

            const filterComplex = subtitles.join(',');
            resolve(filterComplex);
        });
    });
}

// Main function to run the FFmpeg command
async function burnSubtitles() {
    try {
        const filterComplex = await generateFilterComplex();
        const ffmpegCommand = `ffmpeg -i ${inputVideo} -vf "${filterComplex}" -c:a copy ${outputVideo}`;

        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`FFmpeg stderr: ${stderr}`);
            }
            console.log('Subtitles burned successfully!');
        });
    } catch (error) {
        console.error('Error processing subtitles:', error);
    }
}

burnSubtitles();