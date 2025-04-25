require('dotenv').config();
const axios = require('axios');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const { NodeHtmlMarkdown } = require('node-html-markdown');
const nhm = new NodeHtmlMarkdown();

const BASE_DIR = path.join(__dirname, '..', 'data');
const RESPONSES_DIR = path.join(BASE_DIR, 'responses');

const uld = require('./uploader');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://webhook:3000';

async function initializeDirectories() {
  try {
    await fs.ensureDir(RESPONSES_DIR);
  } catch (error) {
    console.error('Error initializing directories:', error);
    await sendErrorWebhook(error);
    throw error;
  }
}

async function sendErrorWebhook(error) {
  try {
    const response = await axios.post(`${WEBHOOK_URL}/error`, {
      error: {
        message: error.message,
        stack: error.stack,
        response: error.response ? {
          status: error.response.status,
          data: error.response.data
        } : null
      }
    });
    console.log('Error notification sent');
    return response.data;
  } catch (sendError) {
    console.error('Error sending error notification:', sendError);
    return null;
  }
}

async function saveAttachmentForItem(session, item) {
  try {
    if (item.attachments[0]){ 
      item.attachments = await Promise.all(item.attachments.map(async (attachment) => {
        try {
          const file_url = await saveAttachment(session, attachment);
          attachment.file_url = file_url;
          return attachment;
        } catch (error) {
          console.error('Error saveAttachment: ',error);
          sendErrorWebhook(error);
          return attachment;
        } 
      }));
      return item;
    }else {
      return item;
    }
  } catch (error) {
    console.error('Error saveAttachmentForItem: ', error);
    sendErrorWebhook(error);
    return item;
  }
}

async function saveAttachment(session, attachment) {
  try {
    const title = attachment.text;
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

    console.log(`get attachment: ${title}`);

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

    const file = response.data.toString('base64');
    const file_url = await uld.uploadFile(file,title)
    console.log(`saved attachment: ${title} url: ${file_url}`);

    return file_url;
  } catch (error) {
    console.error('Error saving attachment:', error);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
      console.error('Request Headers:', error.config.headers);
    }
    throw error;
  }
}

async function processResponse(data,session) {
  try {
    const fileName = `notice.json`;
    const filePath = path.join(RESPONSES_DIR, fileName);

    let previousData = [];
    try {
      const existingData = await fs.readJson(filePath);
      previousData = existingData;
    } catch (error) {
      console.log('No previous response file found, creating new one');
    }

    //delete previous file id
    for (const item of previousData) {
      if (item.attachments[0]) {
        for (const att of item.attachments) {
          if (att.file_url) {
            delete att.file_url;
          }
        }
      }
    }

    let updatedItems = [];
    let newItems = [];

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
        
        const isUpdated_nodetail = new Date(newItem.updated) > new Date(existingItem.updated) ||
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

          //Notify if there is an item that can't be detected without details (experimental)
          if(!isUpdated_nodetail){
            console.log(`Notice: updated Item ${newItem.id} can't be detected without detail`);
            sendErrorWebhook(new Error(`updated Item ${newItem.id} can't be detected without detail`));
          }
          
          updatedItems.push(newItem);
        }
      }
    }

    console.log(`Found ${newItems.length} new items and ${updatedItems.length} updated items`);
    
    if (newItems.length > 0 || updatedItems.length > 0) {
      if (newItems.length > 20 || updatedItems.length > 20) {
        console.log(`too many new or updated items! skip saving attachment and sending notification`);
      }else {
        try {
          newItems = await Promise.all(newItems.map(item => saveAttachmentForItem(session, item)));
          updatedItems = await Promise.all(updatedItems.map(item => saveAttachmentForItem(session, item)));
          console.log('All save Attachment promises were resolved');
        } catch (error) {
          console.error('Error save attachment: ', error);
          await sendErrorWebhook(error);
        }

        try {
          await axios.post(`${WEBHOOK_URL}/notify`, {
            new: newItems,
            updated: updatedItems
          });
          console.log('Notification sent successfully');
        } catch (error) {
          console.error('Error sending notification:', error);
          await sendErrorWebhook(error);
        }
      }
    }
    
    await fs.writeJson(filePath, data, { spaces: 2 });
    console.log('Response saved:', fileName);
    return filePath;
  } catch (error) {
    console.error('Error saving response:', error);
    await sendErrorWebhook(error);
    throw error;
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
      responseType: 'arraybuffer'
    });

    const mainPageRaw = await session.post(loginUrl, `MAILADDRESS=${loginId}&LOGINPASS=${loginPassword}`);

    const cookies = mainPageRaw.headers['set-cookie'];
    if (cookies) {
      const cookieString = cookies.map(cookie => cookie.split(';')[0]).concat('; ').join('');
      session.defaults.headers.Cookie = cookieString;
      console.log('Cookie set:', cookieString);
    }

    const mainPage = iconv.decode(mainPageRaw.data, 'Shift_JIS');
    const $main = cheerio.load(mainPage);

    const ASP_NET_SessionId_Url = 'https://ep.med.toho-u.ac.jp' + $main('iframe').attr('src');
    const ASP_NET_SessionId_PageRaw = await session.get(ASP_NET_SessionId_Url);
    const ASP_NET_SessionIds = ASP_NET_SessionId_PageRaw.headers['set-cookie'];
    if (ASP_NET_SessionIds) {
      const ASP_NET_SessionId_String = ASP_NET_SessionIds.map(cookie => cookie.split(';')[0]).concat('; ').join('');
      session.defaults.headers.Cookie += ASP_NET_SessionId_String;
      console.log('Cookie update:', session.defaults.headers.Cookie);
    }


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
                throw error;
              }
            }
            data.push(rowData);
          }
        }
      } else {
        console.log(`Table not found: ${table_tag}`);
      }
    }

    await processResponse(data,session);
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
            text: line.find('td').text().trim().replace(/添付ファイル\d+ \(\w+\) /,""),
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
    throw error;
  }
}

console.log('Scraper started');
scrape();

const cron = require('node-cron');
cron.schedule('*/15 * * * *', () => {
  console.log('Starting scheduled scraping');
  scrape();
}); 