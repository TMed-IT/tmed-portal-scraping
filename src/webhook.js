require('dotenv').config();
const axios = require('axios');
const express = require('express');
const app = express();

app.use(express.json());

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
      return attachments.map(att => att.file_id ? `- <${att.file_id}|${att.text}>` : `- ${att.text}`).join('\n');
    };

    const message = `*${type === 'new' ? '【新規】' : '【更新】'}*\n\n` +
      `*${item.title}*\n\n` +
      `*対象:* ${item.to.join(', ')}\n` +
      `*日時:* ${formatDate(item.posted)} 投稿, ${formatDate(item.updated)} 更新\n\n` +
      `${item.content || '閲覧権限がありません'}` +
      (item.attachments && item.attachments.length > 0 ? `\n\n*添付ファイル:*\n${formatAttachments(item.attachments)}` : '');

    const targetGrades = new Set();

    for (const target of item.to) {
      if (target === '全医学部生' || target === '全学') {
        Object.keys(webhookUrls).forEach(year => targetGrades.add(year));
        break;
      } else if (target.match(/^M[1-6]$/)) {
        targetGrades.add(target);
      }
    }

    for (const grade of targetGrades) {
      const webhookUrl = webhookUrls[grade];
      if (!webhookUrl) {
        console.log(`WebHook URL for ${grade} is not set. Skipping...`);
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

        console.log(`Sent Google Chat notification to ${grade}: ${item.title}`);
      } catch (error) {
        console.error(`Error sending notification to ${grade}:`, error);
        if (error.response) {
          console.error('Status:', error.response.status);
          console.error('Response:', error.response.data);
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Webhook sending error:', error);
    return null;
  }
}

app.post('/notify', async (req, res) => {
  try {
    const { new: newItems, updated: updatedItems } = req.body;
    
    for (const item of newItems) {
      await sendWebhook(item, 'new');
    }
    
    for (const item of updatedItems) {
      await sendWebhook(item, 'updated');
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error processing notification:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/error', async (req, res) => {
  try {
    const message = 'Error tmed-portal-scraping detail: '+ JSON.stringify(req.body.error, null, '\t') + '\n';
    try {
      const Error_webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      const response = await axios.post(Error_webhookUrl,{
        content: message.length > 1900 ? message.slice(0, 1900) + '...（The rest is omitted）' : message
      },{
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`Sent Error notification`);
    } catch (error) {
      console.error(`Error sending error message to discord:`, error);
        if (error.response) {
          console.error('Status:', error.response.status);
          console.error('Response:', error.response.data);
        }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error processing notification:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
}); 