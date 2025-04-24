// npm install axios mime-types
require('dotenv').config();
const axios = require('axios');
const mime = require('mime-types');
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN;
const UPLOAD_URL = process.env.UPLOAD_URL;

async function uploadFile(file,title) {
  const payload = {
    token: UPLOAD_TOKEN,
    filename: title,
    mimeType: mime.lookup(title) || 'application/octet-stream',
    fileData: file
  };

  try {
    const res = await axios.post(UPLOAD_URL, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('upload result:', res.data);
    
    if (res.data.fileUrl){
        return res.data.fileUrl;
    } else {
        console.error('no fileUrl in respose',title, res.data);
        return null;
    }
  } catch (err) {
    console.error('upload failed:',title, err.response ? err.response.data : err.message);
    return null;
  }
}

module.exports = { uploadFile };