require('dotenv').config();
const axios = require('axios');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const { NodeHtmlMarkdown } = require('node-html-markdown');
const nhm = new NodeHtmlMarkdown();

const BASE_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ATTACHMENTS_DIR = path.join(BASE_DIR, 'attachments');
const RESPONSES_DIR = path.join(BASE_DIR, 'responses');

async function initializeDirectories() {
  try {
    await fs.ensureDir(ATTACHMENTS_DIR);
    await fs.ensureDir(RESPONSES_DIR);
  } catch (error) {
    console.error('Error initializing directories:', error);
    await sendErrorWebhook(error);
    throw error;
  }
}

async function saveAttachment(session, attachment, title) {
  try {
    if (!attachment.url) {
      console.log('Attachment URL not found:', attachment.text);
      return;
    }

    const fullUrl = 'https://ep.med.toho-u.ac.jp/' + attachment.url;

    const response = await session.get(fullUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400; 
      }
    });

    const contentType = response.headers['content-type'];
    if (contentType && contentType.includes('text/html')) {
      console.warn('Warning: Received HTML response instead of file');
      return null;
    }

    const contentDisposition = response.headers['content-disposition'];
    if (contentDisposition) {
      const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
      if (matches != null && matches[1]) {
        fileName = matches[1].replace(/['"]/g, '');
      }
    }

    const filePath = path.join(ATTACHMENTS_DIR, title);

    await fs.writeFile(filePath, response.data);
    console.log('Attachment saved:', title);
    return filePath;
  } catch (error) {
    console.error('Error saving attachment:', error);
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Headers:', error.response.headers);
      console.log('Request Headers:', error.config.headers);
    }
    await sendErrorWebhook(error);
    return null;
  }
}

async function sendWebhook(item, type) {
  try {
    const webhookUrls = {
      'M1': process.env.WEBHOOK_URL_M1,
      'M2': process.env.WEBHOOK_URL_M2,
      'M3': process.env.WEBHOOK_URL_M3,
      'M4': process.env.WEBHOOK_URL_M4,
      'M5': process.env.WEBHOOK_URL_M5,
      'M6': process.env.WEBHOOK_URL_M6
    };

    const formatDate = (date) => {
      return new Date(date).toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    const formatAttachments = (attachments) => {
      return attachments.map(att => `- ${att.text}`).join('\n');
    };

    const message = `*${type === 'new' ? '【新規】' : '【更新】'}*\n\n` +
      `*${item.title}*\n\n` +
      `*対象:* ${item.to.join(', ')}\n` +
      `*日時:* ${formatDate(item.posted)} 投稿, ${formatDate(item.updated)} 更新\n\n` +
      `${item.content || '閲覧権限がありません'}` +
      (item.attachments && item.attachments.length > 0 ? `\n\n*添付ファイル:*\n${formatAttachments(item.attachments)}` : '');

    const targetYears = new Set();

    // 対象者の判定
    for (const target of item.to) {
      if (target === '全医学部生' || target === '全学') {
        // 全学年に送信
        Object.keys(webhookUrls).forEach(year => targetYears.add(year));
        break;
      } else if (target.match(/^M[1-6]$/)) {
        // 特定の学年に送信
        targetYears.add(target);
      }
    }

    // 通知の送信
    for (const year of targetYears) {
      const webhookUrl = webhookUrls[year];
      if (!webhookUrl) {
        console.log(`${year}のWebhook URLが設定されていません。スキップします。`);
        continue;
      }

      try {
        const response = await axios.post(webhookUrl, {
          text: message
        }, {
          headers: {
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });

        console.log(`${year}へのGoogle Chat通知を送信しました: ${item.title}`);
      } catch (error) {
        console.error(`${year}への通知送信エラー:`, error);
        if (error.response) {
          console.error('Status:', error.response.status);
          console.error('Response:', error.response.data);
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Webhook送信エラー:', error);
    return null;
  }
}

async function sendErrorWebhook(error) {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log('Discord Webhook URLが設定されていません。Discord通知をスキップします。');
      return;
    }

    const embed = {
      title: 'Error',
      color: 0xff0000,
      fields: [
        {
          name: 'Error Message',
          value: error.message || 'Unknown error',
          inline: false
        }
      ],
      timestamp: new Date().toISOString()
    };

    if (error.response) {
      embed.fields.push({
        name: 'Response Status',
        value: error.response.status.toString(),
        inline: true
      });
    }

    const response = await axios.post(webhookUrl, {
      embeds: [embed]
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Discord error notification sent');
    return response.data;
  } catch (sendError) {
    console.error('Discord webhook send error:', sendError);
    return null;
  }
}

async function processResponse(data) {
  try {
    const fileName = `response.json`;
    const filePath = path.join(RESPONSES_DIR, fileName);

    let previousData = [];
    try {
      const existingData = await fs.readJson(filePath);
      previousData = existingData;
    } catch (error) {
      console.log('No previous response file found, creating new one');
    }

    const updatedItems = [];
    const newItems = [];

    for (const newItem of data) {
      const existingItem = previousData.find(item => item.id === newItem.id);
      
      if (!existingItem) {
        newItems.push(newItem);
      } else {
        const isUpdated = 
          new Date(newItem.updated) > new Date(existingItem.updated) ||
          newItem.content !== existingItem.content ||
          JSON.stringify(newItem.attachments) !== JSON.stringify(existingItem.attachments) ||
          newItem.from !== existingItem.from ||
          JSON.stringify(newItem.to) !== JSON.stringify(existingItem.to) ||
          newItem.title !== existingItem.title;

        if (isUpdated) {
          console.log(`Item ${newItem.id} has been updated:`);
          console.log('- Title changed:', newItem.title !== existingItem.title);
          console.log('- Content changed:', newItem.content !== existingItem.content);
          console.log('- Attachments changed:', JSON.stringify(newItem.attachments) !== JSON.stringify(existingItem.attachments));
          console.log('- From changed:', newItem.from !== existingItem.from);
          console.log('- To changed:', JSON.stringify(newItem.to) !== JSON.stringify(existingItem.to));
          console.log('- Update time changed:', new Date(newItem.updated) > new Date(existingItem.updated));
          
          updatedItems.push(newItem);
        }
      }
    }

    console.log(`Found ${newItems.length} new items and ${updatedItems.length} updated items`);
    
    for (const item of newItems) {
      console.log('New item:', item.title);
      await sendWebhook(item, 'new');
    }

    for (const item of updatedItems) {
      console.log('Updated item:', item.title);
      await sendWebhook(item, 'updated');
    }

    await fs.writeJson(filePath, data, { spaces: 2 });
    console.log('Response saved:', fileName);
    return filePath;
  } catch (error) {
    console.error('Error saving response:', error);
    await sendErrorWebhook(error);
    return null;
  }
}

async function scrape() {
  try {
    await initializeDirectories();

    const loginUrl = 'https://ep.med.toho-u.ac.jp/default.asp';
    const loginId = process.env.LOGIN_ID;
    const loginPassword = process.env.LOGIN_PASSWORD;

    if (!loginId || !loginPassword) {
      throw new Error('env LOGIN_ID or LOGIN_PASSWORD is not set');
    }

    const session = axios.create({
      withCredentials: true,
      responseType: 'arraybuffer'  // Response type is binary data
    });

    const mainPageRaw = await session.post(loginUrl, `MAILADDRESS=${loginId}&LOGINPASS=${loginPassword}`);

    const cookies = mainPageRaw.headers['set-cookie'];
    if (cookies) {
      const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
      session.defaults.headers.Cookie = cookieString;
      console.log('Cookie set:', cookieString);
    }

    const mainPage = iconv.decode(mainPageRaw.data, 'Shift_JIS');
    const $main = cheerio.load(mainPage);

    let currentYear = new Date().getFullYear();
    let previousUpdated = null;

    function parseDate(dateStr, year) {
      const [monthDay, time] = dateStr.split(' ');
      if (!monthDay || !time) {
        return new Date(year, 0, 1);
      }
      const [month, day] = monthDay.split('/');
      const [hour, minute] = time.split(':');
      const monthNum = parseInt(month, 10);
      const dayNum = parseInt(day, 10);
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute, 10);
      if (isNaN(monthNum) || isNaN(dayNum) || isNaN(hourNum) || isNaN(minuteNum)) {
        return new Date(year, 0, 1);
      }
      return new Date(year, monthNum - 1, dayNum, hourNum, minuteNum);
    }

    function parseFullDate(dateStr) {
      if (!dateStr) return new Date();
      const regex = /(\d{4})\D+(\d{1,2})\D+(\d{1,2}).*?(\d{1,2}):(\d{1,2})/;
      const match = dateStr.match(regex);
      if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        const hour = parseInt(match[4], 10);
        const minute = parseInt(match[5], 10);
        const d = new Date(year, month - 1, day, hour, minute);
        if (isNaN(d.getTime())) {
          return new Date();
        }
        return d;
      }
      const fallback = new Date(dateStr);
      return isNaN(fallback.getTime()) ? new Date() : fallback;
    }

    const table_tags = ["#T1", "#T2", "#T3", "#T4"]
    const data = [];

    for (let table_tag of table_tags) {
      const table = $main(table_tag);
      if (table.length > 0) {
        for (let i = 4; i < table.find('tr').length; i++) {
          console.log(`Processing row ${i + 1} of ${table_tag}`);
          const row = table.find('tr')[i];
          const cells = $main(row).find('td');

          if (cells.length >= 5) {
            const rowData = {};

            rowData['to'] = $main(cells[0]).text().trim().split(',').map(t => t.trim());
            rowData['from'] = $main(cells[1]).text().trim();

            const postedText = $main(cells[2]).text().trim();
            const updatedText = $main(cells[3]).text().trim();

            let updatedCandidate = parseDate(updatedText, currentYear);
            if (previousUpdated && updatedCandidate > previousUpdated) {
              currentYear--;
              updatedCandidate = parseDate(updatedText, currentYear);
            }
            const postedCandidate = parseDate(postedText, currentYear);
            rowData['posted'] = postedCandidate;
            rowData['updated'] = updatedCandidate;
            previousUpdated = updatedCandidate;

            rowData['title'] = $main(cells[4]).text().trim();
            const href = $main(cells[4]).find('a').attr('href');
            const idMatch = href.match(/dID=(\d+)/);
            rowData['id'] = idMatch ? idMatch[1] : null;
            if (href) {
              try {
                const detail = await fetchDetailPage(href);
                Object.assign(rowData, detail);

                // if (detail.attachments && detail.attachments.length > 0) {
                //   rowData['savedAttachments'] = [];
                //   for (const attachment of detail.attachments) {
                //     const savedPath = await saveAttachment(session, attachment, rowData.title);
                //     if (savedPath) {
                //       rowData['savedAttachments'].push({
                //         originalName: attachment.text,
                //         savedPath: savedPath
                //       });
                //     }
                //   }
                // }

                if (rowData.fullUpdated) {
                  const fullYear = rowData.fullUpdated.getFullYear();
                  const originalPosted = rowData.posted;
                  const originalUpdated = rowData.updated;
                  if (originalPosted.getTime() === originalUpdated.getTime() || originalUpdated < originalPosted) {
                    rowData.posted = new Date(
                      fullYear,
                      originalPosted.getMonth(),
                      originalPosted.getDate(),
                      originalPosted.getHours(),
                      originalPosted.getMinutes()
                    );
                    rowData.updated = new Date(
                      fullYear,
                      originalUpdated.getMonth(),
                      originalUpdated.getDate(),
                      originalUpdated.getHours(),
                      originalUpdated.getMinutes()
                    );
                  }
                  else if (originalPosted < originalUpdated) {
                    rowData.updated = new Date(
                      fullYear,
                      originalUpdated.getMonth(),
                      originalUpdated.getDate(),
                      originalUpdated.getHours(),
                      originalUpdated.getMinutes()
                    );
                  }
                }
              } catch (error) {
                console.log(`Error fetching detail page for row ${i + 1}: ${error.message}`);
                await sendErrorWebhook(error);
              }
            }
            data.push(rowData);
          }
        }
      } else {
        console.log(`Table not found: ${table_tag}`);
      }
    }

    await processResponse(data);
    console.log('Scraping completed');

    async function fetchDetailPage(url) {
      const fullUrl = 'https://ep.med.toho-u.ac.jp/' + url;
      const detailPageRaw = await session.get(fullUrl);
      const detailPage = iconv.decode(detailPageRaw.data, 'Shift_JIS');
      const $detail = cheerio.load(detailPage);

      const detail = {};
      const attachments = [];
      const lines = $detail("body > div.clsContainer > div > table.clsTb > tbody").find('tr');

      for (let k = 1; k < lines.length; k++) {
        const line = $detail(lines[k]);
        if (k === 1) {
          const fullDateText = line.find('td').text().trim();
          detail['fullUpdated'] = parseFullDate(fullDateText);
        } else if (k === 2) {
          const contentRaw = line.find('td').html();
          const content = nhm.translate(contentRaw).trim();
          detail['content'] = content;
        } else if (k >= 3) {
          const attachment = {
            text: line.find('td').text().trim(),
            url: line.find('a').attr('href')
          };
          attachments.push(attachment);
        }
      }

      detail['attachments'] = attachments;
      return detail;
    }

  } catch (error) {
    console.error('Error:', error.message);
    await sendErrorWebhook(error);
  }
}

console.log('Application started');
scrape();

cron.schedule('*/15 * * * *', () => {
  console.log('Starting scheduled scraping');
  scrape();
}); 