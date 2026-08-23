import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3000;

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
