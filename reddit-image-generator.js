const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

async function generateScreenshot(storyName, cropTop, cropBottom) {
    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 300 });

    // Read the HTML template
    const templatePath = path.join(__dirname, 'template.html');
    let htmlContent = await fs.readFile(templatePath, 'utf8');

    // Replace the placeholder with the actual story name
    htmlContent = htmlContent.replace('{{STORY_TITLE}}', storyName);

    // Set the modified HTML content to the page
    await page.setContent(htmlContent);

    // Take a screenshot
    const screenshotBuffer = await page.screenshot();

    await browser.close();

    // Process the image with sharp
    const metadata = await sharp(screenshotBuffer).metadata();
    const croppedHeight = metadata.height - cropTop - cropBottom;

    // Return the processed buffer
    return await sharp(screenshotBuffer)
        .extract({ left: 0, top: cropTop, width: metadata.width, height: croppedHeight })
        .toBuffer();
}

app.post('/generate-screenshot', async (req, res) => {
    try {
        const { storyName, cropTop, cropBottom } = req.body;

        if (!storyName || cropTop === undefined || cropBottom === undefined) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const screenshotBuffer = await generateScreenshot(storyName, cropTop, cropBottom);

        res.set('Content-Type', 'image/png');
        res.send(screenshotBuffer);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred while generating the screenshot' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});