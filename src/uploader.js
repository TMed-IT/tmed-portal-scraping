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
        throw new Error('Error no fileUrl in respose: '+ JSON.stringify(res.data));
    }
  } catch (err) {
    console.error('Error upload failed:'+ title + err);
    throw err;
  }
}

module.exports = { uploadFile };