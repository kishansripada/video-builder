const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const util = require('util');
const { exec } = require('child_process');
const { createClient } = require("@supabase/supabase-js")
const execAsync = util.promisify(exec);
const ffmpegStatic = require('ffmpeg-static');
const multer = require('multer');
const express = require('express');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

ffmpeg.setFfmpegPath(ffmpegStatic);

class VideoProcessor {
    constructor() {
        this.tempFiles = [];
    }

    async createTempFile(prefix, buffer = null, extension = '') {
        const tempPath = path.join(os.tmpdir(), `${prefix}_${Date.now()}${extension}`);
        this.tempFiles.push(tempPath);
        if (buffer) {
            await fs.writeFile(tempPath, buffer);
        }
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
        const outputPath = await this.createTempFile('trimmed', null, '.mp4');
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .setDuration(duration)
                .output(outputPath)
                .on('end', () => {
                    console.log('Video trimmed successfully');
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
        const outputPath = await this.createTempFile('noaudio', null, '.mp4');
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .noAudio()
                .output(outputPath)
                .on('end', () => {
                    console.log('Audio removed successfully');
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
        const outputPath = await this.createTempFile('withoverlay', null, '.mp4');
        const tempImagePath = await this.createTempFile('overlay', imageBuffer, '.png');

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
                    console.log('Overlay applied successfully');
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('Error applying overlay:', err);
                    reject(err);
                })
                .run();
        });
    }

    async applyAudio(inputPath, vocalsAudioBuffer, outputPath) {
        const tempAudioPath = await this.createTempFile('vocals', vocalsAudioBuffer);
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .input(tempAudioPath)
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

    generateFilterComplex(subtitlesJson) {
        const subtitles = subtitlesJson.map(({ word, startTime, endTime }) => {
            if (startTime !== undefined && endTime !== undefined) {
                return `drawtext=fontfile='Bangers-Regular.ttf':text='${this.escapeText(word)}':fontsize=60:fontcolor=0xFAE54D:borderw=4:bordercolor=black:x=(w-tw)/2:y=(h-th)/2:enable='between(t,${startTime},${endTime})'`;
            }
            return null;
        }).filter(Boolean);

        return subtitles.join(',');
    }

    async burnSubtitles(inputPath, subtitlesJson) {
        try {
            const outputPath = await this.createTempFile('with_subtitles', null, '.mp4');
            const filterComplex = this.generateFilterComplex(subtitlesJson);
            const ffmpegCommand = `ffmpeg -i "${inputPath}" -vf "${filterComplex}" -c:a copy "${outputPath}"`;

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

async function processVideoWithOverlayAndAudio(inputPath, outputPath, storyName, vocalsAudioBuffer, subtitlesJson, imageBuffer) {
    const processor = new VideoProcessor();

    try {
        const tempAudioPath = await processor.createTempFile('vocals', vocalsAudioBuffer, '.mp3');
        const duration = await processor.getAudioDuration(tempAudioPath);
        console.log(`Processing video with duration: ${duration} seconds`);

        const trimmedPath = await processor.trimVideo(inputPath, duration);
        const noAudioPath = await processor.removeAudio(trimmedPath);

        let withSubtitlesPath = noAudioPath;
        if (subtitlesJson && subtitlesJson.length > 0) {
            withSubtitlesPath = await processor.burnSubtitles(noAudioPath, subtitlesJson);
        }

        const withOverlayPath = await processor.applyOverlay(withSubtitlesPath, imageBuffer);
        const finalOutputPath = await processor.applyAudio(withOverlayPath, vocalsAudioBuffer, outputPath);

        const supabase = createClient(
            "https://dxtxbxkkvoslcrsxbfai.supabase.co",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4dHhieGtrdm9zbGNyc3hiZmFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY2MTQ2Mzc0NiwiZXhwIjoxOTc3MDM5NzQ2fQ.1Sbj1t90pvU2JveRQj0YvCGddbo5ojph-SBcPtGgNDo"
        );

        const fileBuffer = await fs.readFile(finalOutputPath);
        const filename = `video_${Date.now()}.mp4`;

        const { data, error } = await supabase.storage
            .from('videos')
            .upload(filename, fileBuffer, {
                contentType: 'video/mp4'
            });
        console.log(data, error)
        return data

    } catch (error) {
        console.error('Video processing failed:', error);
        throw error;
    } finally {
        await processor.cleanup();
    }
}

const inputVideo = path.join(__dirname, 'background_video.mp4');
const outputVideo = path.join(__dirname, 'output_with_overlay_audio_and_subs.mp4');

async function main(imageBuffer, audioBuffer, subtitlesJson) {
    try {
        return await processVideoWithOverlayAndAudio(inputVideo, outputVideo, "ER doctors of reddit, what's the worse thing you've ever seen in an operating room?", audioBuffer, subtitlesJson, imageBuffer);
    } catch (err) {
        console.error('Main process failed:', err);
    }
}

app.post('/', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async function (req, res) {
    try {
        if (!req.files['image'] || !req.files['audio'] || !req.body.subtitles) {
            return res.status(400).json({ error: 'Image, audio, and subtitle JSON are required' });
        }

        const imageBuffer = req.files['image'][0].buffer;
        const audioBuffer = req.files['audio'][0].buffer;
        const subtitlesJson = JSON.parse(req.body.subtitles);
        const response = await main(imageBuffer, audioBuffer, subtitlesJson);

        res.json(response);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', function (req, res) {
    res.send('Hello World')
});

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
// const URL_PREFIX = "https://dxtxbxkkvoslcrsxbfai.supabase.co/storage/v1/object/public/" + fullPath