require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const iconv = require('iconv-lite');

async function scrapePortal() {
    try {
        const response = await axios.get(process.env.PORTAL_URL, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const html = iconv.decode(response.data, 'Shift_JIS');
        const $ = cheerio.load(html);

        // ここにスクレイピングのロジックを実装
        const data = {
            timestamp: new Date().toISOString(),
            // スクレイピングしたデータをここに追加
        };

        // 結果をJSONファイルとして保存
        const outputDir = path.join(__dirname, '../output');
        await fs.ensureDir(outputDir);
        await fs.writeJson(path.join(outputDir, 'scraped_data.json'), data, { spaces: 2 });

        console.log('スクレイピングが完了しました');
    } catch (error) {
        console.error('エラーが発生しました:', error.message);
    }
}

// スクレイピングを実行
scrapePortal(); 