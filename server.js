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

// Middleware for large payload (support up to 60MB for videos & documents)
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Stream upload endpoint: highly efficient direct binary streaming with zero memory overhead
app.post('/api/upload-stream', (req, res) => {
  try {
    const rawFilename = decodeURIComponent(req.query.filename || req.headers['x-filename'] || 'file.bin');
    const mimeType = decodeURIComponent(req.query.mimeType || req.headers['content-type'] || 'application/octet-stream');
    const ext = path.extname(rawFilename) || '.bin';
    const safeBase = path.basename(rawFilename, ext).replace(/[^a-zA-Z0-9_\-\uAC00-\uD7A3]/g, '_');
    const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${safeBase}${ext}`;
    const targetPath = path.join(uploadsDir, uniqueName);

    const writeStream = fs.createWriteStream(targetPath);
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      let type = 'file';
      const isVideo = mimeType.startsWith('video/') || /\.(mp4|mov|webm|avi|mkv|m4v|3gp|wmv|flv)$/i.test(rawFilename);
      const isAudio = mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(rawFilename);
      const isImg = mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp|heic|heif)$/i.test(rawFilename);
      if (isImg) type = 'image';
      else if (isVideo) type = 'video';
      else if (isAudio) type = 'audio';

      res.json({
        url: `/uploads/${uniqueName}`,
        name: rawFilename,
        type,
        mime: mimeType,
        size: totalBytes,
      });
    });

    writeStream.on('error', (err) => {
      console.error('writeStream error', err);
      res.status(500).json({ error: '서버 파일 저장 중 오류가 발생했습니다.' });
    });
  } catch (err) {
    console.error('upload-stream error', err);
    res.status(500).json({ error: '스트림 업로드 처리 중 오류가 발생했습니다.' });
  }
});

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
    const isVideo = (mimeType && mimeType.startsWith('video/')) || /\.(mp4|mov|webm|avi|mkv|m4v|3gp)$/i.test(filename);
    const isAudio = (mimeType && mimeType.startsWith('audio/')) || /\.(mp3|wav|ogg|m4a|aac)$/i.test(filename);
    const isImg = (mimeType && mimeType.startsWith('image/')) || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename);
    if (isImg) type = 'image';
    else if (isVideo) type = 'video';
    else if (isAudio) type = 'audio';

    res.json({
      url: `/uploads/${uniqueName}`,
      name: filename,
      type,
      mime: mimeType || 'application/octet-stream',
      size: buffer.length,
    });
  } catch (err) {
    console.error('upload error', err);
    res.status(500).json({ error: '파일 업로드 처리 중 오류가 발생했습니다.' });
  }
});

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir, { maxAge: '30d' }));

app.get('/firebase-messaging-sw.js', (req, res) => {
  const filePath = path.join(process.cwd(), 'firebase-messaging-sw.js');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  let content = fs.readFileSync(filePath, 'utf8');
  if (process.env.FIREBASE_API_KEY && process.env.FIREBASE_API_KEY.trim()) {
    content = content.replace('AIzaSyA5FX6asrpW83siWWh-j9kltfIJKsY952o', process.env.FIREBASE_API_KEY.trim());
  }
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.send(content);
});

app.get(['/app.js', '*/app.js'], (req, res) => {
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

app.get(['/styles.css', '*/styles.css'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'styles.css'));
});

app.get(['/favicon.svg', '*/favicon.svg'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'favicon.svg'));
});

// Posts persistent JSON store
const postsFile = path.join(process.cwd(), 'posts-data.json');
function readPosts() {
  try {
    if (fs.existsSync(postsFile)) {
      const data = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.error('readPosts error', e);
  }
  return [];
}
function writePosts(posts) {
  try {
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2), 'utf8');
  } catch (e) {
    console.error('writePosts error', e);
  }
}

app.get('/api/posts', (req, res) => {
  const posts = readPosts();
  res.json(posts);
});

app.post('/api/posts', (req, res) => {
  try {
    const { authorUid, authorName, authorUsername, authorAvatar, content, media } = req.body;
    if (!authorUid) {
      return res.status(400).json({ error: '사용자 인증 정보가 필요합니다.' });
    }
    const posts = readPosts();
    const newPost = {
      id: 'post_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      authorUid: String(authorUid),
      authorName: String(authorName || '익명'),
      authorUsername: String(authorUsername || 'user'),
      authorAvatar: String(authorAvatar || '👤'),
      content: String(content || ''),
      media: media || null,
      likes: [],
      likeCount: 0,
      commentCount: 0,
      comments: [],
      createdAt: new Date().toISOString(),
    };
    posts.unshift(newPost);
    writePosts(posts);
    res.json(newPost);
  } catch (err) {
    console.error('save-post-error', err);
    res.status(500).json({ error: '게시물 저장 처리 중 오류가 발생했습니다.' });
  }
});

app.post('/api/posts/:id/like', (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'uid missing' });
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post) return res.status(404).json({ error: 'post not found' });
    if (!Array.isArray(post.likes)) post.likes = [];
    const idx = post.likes.indexOf(uid);
    if (idx > -1) {
      post.likes.splice(idx, 1);
    } else {
      post.likes.push(uid);
    }
    post.likeCount = post.likes.length;
    writePosts(posts);
    res.json({ likes: post.likes, likeCount: post.likeCount });
  } catch (err) {
    res.status(500).json({ error: 'like-error' });
  }
});

app.post('/api/posts/:id/comment', (req, res) => {
  try {
    const { id } = req.params;
    const { authorUid, authorName, authorUsername, authorAvatar, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text missing' });
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post) return res.status(404).json({ error: 'post not found' });
    if (!Array.isArray(post.comments)) post.comments = [];
    const comment = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      authorUid: String(authorUid || ''),
      authorName: String(authorName || '익명'),
      authorUsername: String(authorUsername || 'user'),
      authorAvatar: String(authorAvatar || '👤'),
      text: String(text).trim(),
      createdAt: new Date().toISOString(),
    };
    post.comments.push(comment);
    post.commentCount = post.comments.length;
    writePosts(posts);
    res.json(comment);
  } catch (err) {
    res.status(500).json({ error: 'comment-error' });
  }
});

app.put('/api/posts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { uid, content, media } = req.body;
    if (!uid) return res.status(400).json({ error: '인증 정보가 필요합니다.' });
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post) return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });
    if (post.authorUid !== uid) {
      return res.status(403).json({ error: '수정 권한이 없습니다.' });
    }
    if (typeof content === 'string') {
      post.content = content.trim();
    }
    if (media !== undefined) {
      post.media = media;
    }
    post.updatedAt = new Date().toISOString();
    writePosts(posts);
    res.json(post);
  } catch (err) {
    console.error('update-post-error', err);
    res.status(500).json({ error: '게시물 수정 처리 오류' });
  }
});

app.delete('/api/posts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const uid = req.body?.uid || req.query?.uid;
    let posts = readPosts();
    const target = posts.find((p) => p.id === id);
    if (!target) return res.status(404).json({ error: 'not found' });
    if (uid && target.authorUid !== uid) {
      return res.status(403).json({ error: '삭제 권한이 없습니다.' });
    }
    posts = posts.filter((p) => p.id !== id);
    writePosts(posts);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'delete-error' });
  }
});

app.use(express.static(process.cwd()));

// SPA fallback for routing (e.g. /@username, /feed, /chat, /lounge, etc.)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(process.cwd(), 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

