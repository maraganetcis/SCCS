import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3000;

// Uploads directory
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 60-day auto cleanup routine to conserve server storage
function cleanupOldUploads() {
  try {
    const now = Date.now();
    const maxAgeMs = 60 * 24 * 60 * 60 * 1000; // 60 days
    if (!fs.existsSync(uploadsDir)) return;
    const files = fs.readdirSync(uploadsDir);
    let cleaned = 0;
    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[Storage Auto-Clean] ${cleaned}개의 60일 지난 오래된 서버 파일 자동 정리 완료`);
    }
  } catch (e) {
    console.warn('cleanup-error', e);
  }
}
cleanupOldUploads();
setInterval(cleanupOldUploads, 24 * 60 * 60 * 1000);

// Middleware for large payload (up to 30MB for short videos & documents)
app.use(express.json({ limit: '35mb' }));

app.post('/api/upload', (req, res) => {
  try {
    const { filename, mimeType, data } = req.body;
    if (!filename || !data) {
      return res.status(400).json({ error: '파일 데이터가 누락되었습니다.' });
    }

    const ext = path.extname(filename) || '.bin';
    const safeBase = path.basename(filename, ext).replace(/[^a-zA-Z0-9_\-\uAC00-\uD7A3]/g, '_');
    const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${safeBase}${ext}`;
    const targetPath = path.join(uploadsDir, uniqueName);

    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(targetPath, buffer);

    let type = 'file';
    if (mimeType.startsWith('image/')) type = 'image';
    else if (mimeType.startsWith('video/')) type = 'video';
    else if (mimeType.startsWith('audio/')) type = 'audio';

    res.json({
      url: `/uploads/${uniqueName}`,
      name: filename,
      type,
      mime: mimeType,
      size: buffer.length,
    });
  } catch (err) {
    console.error('upload error', err);
    res.status(500).json({ error: '파일 업로드 처리 중 오류가 발생했습니다.' });
  }
});

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir, { maxAge: '30d' }));

app.get('/app.js', (req, res) => {
  const filePath = path.join(process.cwd(), 'app.js');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  let content = fs.readFileSync(filePath, 'utf8');
  if (process.env.FIREBASE_API_KEY && process.env.FIREBASE_API_KEY.trim()) {
    content = content.replace('AIzaSyA5FX6asrpW83siWWh-j9kltfIJKsY952o', process.env.FIREBASE_API_KEY.trim());
  }
  res.type('application/javascript');
  res.send(content);
});

app.use(express.static(process.cwd()));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

