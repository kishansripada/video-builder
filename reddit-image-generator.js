const { chromium } = require('playwright');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

async function generateScreenshot(storyName, cropTop, cropBottom) {
    const browser = await chromium.launch({
        headless: false,
    });

    const page = await browser.newPage({
        viewport: { width: 400, height: 300 }
    });

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

    // Instead of saving to a file, return the processed buffer
    return await sharp(screenshotBuffer)
        .extract({ left: 0, top: cropTop, width: metadata.width, height: croppedHeight })
        .toBuffer();
}

// Example usage
const storyName = "What's the most fucked up thing you discovered about your 'perfect' family member?";

// Uncomment the following lines to test the function
// generateScreenshot(storyName, 75, 80)
//     .then(buffer => console.log('Screenshot buffer generated successfully', buffer))
//     .catch(error => console.error('Error:', error));

module.exports = { generateScreenshot };