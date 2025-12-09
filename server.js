/*
================================================================================
  QuizCraft Server - Production Ready (Final Logic)
================================================================================
*/

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const Database = require('better-sqlite3');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcrypt');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '3gbup38id9'; 
const SALT_ROUNDS = 10;

// --- DIRECTORY SETUP ---
const RAILWAY_MOUNT = process.env.RAILWAY_VOLUME_MOUNT_PATH; 
const RENDER_MOUNT = process.env.RENDER_DISK_MOUNT_PATH;
const dataPath = RAILWAY_MOUNT || RENDER_MOUNT || __dirname;

const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(dataPath, 'uploads');
const dbDir = path.join(dataPath, 'databases');

[uploadsDir, dbDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- FILE UPLOAD SETUP ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- DATABASE CONNECTION MANAGEMENT ---
const masterDb = new Database(path.join(dbDir, 'master.db'));
masterDb.exec(`CREATE TABLE IF NOT EXISTS hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, db_path TEXT NOT NULL UNIQUE);`);

const dbConnections = new Map();

function generateJoinCode(length = 6) {
    return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

function getHostDb(hostId) {
    if (dbConnections.has(hostId)) {
        return dbConnections.get(hostId);
    }
    const host = masterDb.prepare('SELECT db_path FROM hosts WHERE id = ?').get(hostId);
    if (!host) throw new Error('Host not found');
    
    const dbPath = path.join(dataPath, path.basename(host.db_path));
    const hostDb = new Database(dbPath);
    hostDb.pragma('foreign_keys = ON');
    hostDb.exec(`
        CREATE TABLE IF NOT EXISTS quizzes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            name TEXT NOT NULL, 
            status TEXT NOT NULL DEFAULT 'finished',
            join_code TEXT,
            UNIQUE(name)
        );
        CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, text TEXT NOT NULL, options TEXT NOT NULL, correctOptionIndex INTEGER NOT NULL, timeLimit INTEGER NOT NULL, score INTEGER NOT NULL, negativeScore INTEGER NOT NULL, imageUrl TEXT, FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, name TEXT NOT NULL, branch TEXT, year TEXT, score INTEGER NOT NULL, finishTime INTEGER, answers TEXT, UNIQUE(quiz_id, name));
    `);

    try { hostDb.prepare('ALTER TABLE results ADD COLUMN answers TEXT').run(); } catch (e) {}
    try { hostDb.prepare('ALTER TABLE quizzes ADD COLUMN join_code TEXT').run(); } catch (e) {}

    dbConnections.set(hostId, hostDb);
    return hostDb;
}

// --- IN-MEMORY STATE ---
let quizState = { status: 'finished', hostId: null, quizId: null, quizName: '', questions: [], joinCode: null };
const players = new Map();

// --- SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- EXPRESS ROUTES ---
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir)); 

app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/player', (req, res) => res.sendFile(path.join(publicDir, 'player.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'admin-dashboard.html')));
app.get('/host', (req, res) => res.sendFile(path.join(publicDir, 'host.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
app.get('/leaderboard', (req, res) => res.sendFile(path.join(publicDir, 'leaderboard.html')));

// --- ADMIN API ---
const superAdminAuth = (req, res, next) => {
    if (req.headers.authorization !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Forbidden' });
    next();
};
app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true, token: ADMIN_PASSWORD });
    else res.json({ success: false, message: 'Invalid password' });
});
app.post('/api/admin/hosts', superAdminAuth, (req, res) => {
    const hosts = masterDb.prepare('SELECT id, email FROM hosts').all();
    res.json({ success: true, hosts });
});
app.post('/api/admin/add-host', superAdminAuth, (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required.' });
        const hash = bcrypt.hashSync(password, SALT_ROUNDS);
        const info = masterDb.prepare('INSERT INTO hosts (email, password, db_path) VALUES (?, ?, ?)')
            .run(email, hash, `databases/host_${Date.now()}.db`);
        getHostDb(info.lastInsertRowid);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: 'Email already exists.' }); }
});
app.post('/api/admin/delete-host', superAdminAuth, (req, res) => {
    const host = masterDb.prepare('SELECT * FROM hosts WHERE id = ?').get(req.body.hostId);
    if (host) {
        const dbPath = path.join(dataPath, path.basename(host.db_path));
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        masterDb.prepare('DELETE FROM hosts WHERE id = ?').run(req.body.hostId);
    }
    res.json({ success: true });
});
app.post('/api/admin/update-host-password', superAdminAuth, (req, res) => {
    try {
        const { hostId, newPassword } = req.body;
        if (!newPassword) return res.status(400).json({ success: false, message: 'Password required.' });
        const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
        masterDb.prepare('UPDATE hosts SET password = ? WHERE id = ?').run(hash, hostId);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// --- HOST API ---
const hostAuthMiddleware = (req, res, next) => {
    try {
        const token = req.headers.authorization;
        const host = masterDb.prepare('SELECT id FROM hosts WHERE id = ?').get(token);
        if (!host) return res.status(403).json({ success: false, message: 'Forbidden' });
        req.hostId = host.id;
        req.db = getHostDb(host.id);
        next();
    } catch (e) { res.status(403).json({ success: false, message: 'Forbidden' }); }
};
app.post('/api/host/login', (req, res) => {
    const { email, password } = req.body;
    const host = masterDb.prepare('SELECT * FROM hosts WHERE email = ?').get(email);
    if (host && bcrypt.compareSync(password, host.password)) res.json({ success: true, token: host.id });
    else res.json({ success: false, message: 'Invalid credentials' });
});

app.post('/api/host/quizzes', hostAuthMiddleware, (req, res) => {
    const quizzes = req.db.prepare('SELECT * FROM quizzes ORDER BY id DESC').all();
    res.json({ success: true, quizzes });
});
app.post('/api/host/create-quiz', hostAuthMiddleware, (req, res) => {
    try {
        const info = req.db.prepare('INSERT INTO quizzes (name, join_code) VALUES (?, ?)').run(req.body.name, generateJoinCode());
        res.json({ success: true, quizId: info.lastInsertRowid });
    } catch (e) { res.status(500).json({ success: false, message: 'A quiz with this name already exists.' }); }
});
app.post('/api/host/delete-quiz', hostAuthMiddleware, (req, res) => {
    req.db.prepare('DELETE FROM quizzes WHERE id = ?').run(req.body.quizId);
    res.json({ success: true });
});
app.post('/api/host/quiz-details', hostAuthMiddleware, (req, res) => {
    const { quizId } = req.body;
    const quiz = req.db.prepare('SELECT status, join_code FROM quizzes WHERE id = ?').get(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found'});
    const questions = req.db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id ASC').all(quizId);
    let playerCount = (quizState.quizId === parseInt(quizId) && quizState.hostId === req.hostId) ? players.size : 0;
    res.json({ success: true, details: { status: quiz.status, joinCode: quiz.join_code, playerCount, questions }});
});
app.post('/api/host/add-question', hostAuthMiddleware, upload.single('questionImage'), (req, res) => {
    try {
        const { quizId, text, options, correctOptionIndex, timeLimit, score, negativeScore } = req.body;
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
        const parsedOptions = options.split(',').map(s => s.trim());
        req.db.prepare('INSERT INTO questions (quiz_id, text, options, correctOptionIndex, timeLimit, score, negativeScore, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(quizId, text, JSON.stringify(parsedOptions), correctOptionIndex, timeLimit, score, negativeScore, imageUrl);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/api/host/edit-question', hostAuthMiddleware, upload.single('questionImage'), (req, res) => {
    try {
        const { questionId, text, options, correctOptionIndex, timeLimit, score, negativeScore } = req.body;
        const parsedOptions = options.split(',').map(s => s.trim());
        let imageUrl = undefined;
        if (req.file) imageUrl = `/uploads/${req.file.filename}`;

        if (imageUrl) {
            req.db.prepare('UPDATE questions SET text=?, options=?, correctOptionIndex=?, timeLimit=?, score=?, negativeScore=?, imageUrl=? WHERE id=?')
                .run(text, JSON.stringify(parsedOptions), correctOptionIndex, timeLimit, score, negativeScore, imageUrl, questionId);
        } else {
            req.db.prepare('UPDATE questions SET text=?, options=?, correctOptionIndex=?, timeLimit=?, score=?, negativeScore=? WHERE id=?')
                .run(text, JSON.stringify(parsedOptions), correctOptionIndex, timeLimit, score, negativeScore, questionId);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/api/host/delete-question', hostAuthMiddleware, (req, res) => {
    const question = req.db.prepare('SELECT imageUrl FROM questions WHERE id = ?').get(req.body.id);
    if (question && question.imageUrl) {
        const imagePath = path.join(uploadsDir, path.basename(question.imageUrl)); 
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
    req.db.prepare('DELETE FROM questions WHERE id = ?').run(req.body.id);
    res.json({ success: true });
});
app.post('/api/host/start-quiz', hostAuthMiddleware, (req, res) => {
    if (quizState.status === 'active' || quizState.status === 'waiting') return res.json({ success: false, message: 'Another quiz is already active or waiting.'});
    const { quizId } = req.body;
    const questions = req.db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id ASC').all(quizId);
    if (questions.length === 0) return res.json({ success: false, message: 'This quiz has no questions. Please add questions first.'});

    req.db.prepare("UPDATE quizzes SET status = 'waiting' WHERE id = ?").run(quizId);
    const quiz = req.db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);
    
    quizState = { status: 'waiting', hostId: req.hostId, quizId: quizId, quizName: quiz.name, joinCode: quiz.join_code, questions: questions };
    req.db.prepare('DELETE FROM results WHERE quiz_id = ?').run(quizId);
    players.clear();
    io.emit('leaderboardUpdate', { results: [], quizName: quiz.name });
    res.json({ success: true });
});

// ** FIXED: LAUNCH QUIZ WITH AUTO-RECOVERY **
app.post('/api/host/launch-quiz', hostAuthMiddleware, (req, res) => {
    let targetQuizId = quizState.quizId;

    // RECOVERY: If server memory is 'finished' but host is sending a valid quizId
    if (quizState.status === 'finished' && req.body.quizId) {
        const dbQuiz = req.db.prepare('SELECT status, name, join_code FROM quizzes WHERE id = ?').get(req.body.quizId);
        
        // If the DB says it's waiting, restore the state!
        if (dbQuiz && dbQuiz.status === 'waiting') {
            const questions = req.db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id ASC').all(req.body.quizId);
            quizState = { 
                status: 'waiting', 
                hostId: req.hostId, 
                quizId: req.body.quizId, 
                quizName: dbQuiz.name, 
                joinCode: dbQuiz.join_code, 
                questions: questions 
            };
            targetQuizId = req.body.quizId;
        }
    }

    if (quizState.status !== 'waiting' || quizState.hostId !== req.hostId) {
        return res.json({ success: false, message: 'Quiz is not in a waiting lobby.'});
    }

    quizState.status = 'active';
    req.db.prepare("UPDATE quizzes SET status = 'active' WHERE id = ?").run(targetQuizId);
    io.emit('quizStarted', { quizName: quizState.quizName });
    res.json({ success: true });
});

app.post('/api/host/end-quiz', hostAuthMiddleware, (req, res) => {
    if ((quizState.status !== 'active' && quizState.status !== 'waiting') || quizState.hostId !== req.hostId) return res.json({ success: false, message: 'No quiz active/waiting.'});
    endQuiz();
    res.json({ success: true });
});
app.get('/api/host/results', hostAuthMiddleware, (req, res) => {
    try {
        const { quizId } = req.query;
        const quote = (val) => {
            const str = (val === null || val === undefined) ? '' : String(val);
            const escaped = str.replace(/"/g, '""');
            return (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) ? `"${escaped}"` : escaped;
        };
        const questions = req.db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id ASC').all(quizId);
        const results = req.db.prepare('SELECT name, branch, year, score, answers FROM results WHERE quiz_id = ? ORDER BY score DESC').all(quizId);
        
        let headers = ['Name', 'Branch', 'Year', 'Total Score'];
        questions.forEach((q, i) => headers.push(`Q${i + 1}: ${q.text}`));
        let csv = headers.map(quote).join(',') + '\n';

        results.forEach(r => {
            const playerAnswers = r.answers ? JSON.parse(r.answers) : {};
            let row = [quote(r.name), quote(r.branch), quote(r.year), r.score];
            questions.forEach(q => {
                const selectedOptionIndex = playerAnswers[q.id];
                let answerStatus = 'NO ANSWER';
                if (selectedOptionIndex !== undefined && selectedOptionIndex !== null) {
                    answerStatus = (selectedOptionIndex === q.correctOptionIndex) ? 'Correct' : 'Wrong';
                }
                row.push(quote(answerStatus));
            });
            csv += row.join(',') + '\n';
        });
        res.header('Content-Type', 'text/csv');
        res.attachment(`quiz_${quizId}_results_detailed.csv`);
        res.send(csv);
    } catch(e) { res.status(500).send("Error generating results"); }
});

function endQuiz() {
    if (quizState.status !== 'active' && quizState.status !== 'waiting') return;
    const hostDb = getHostDb(quizState.hostId);
    hostDb.prepare("UPDATE quizzes SET status = 'finished' WHERE id = ?").run(quizState.quizId);
    if (quizState.status === 'active') players.forEach((player, socketId) => io.to(socketId).emit('quizFinished', { score: player.score }));
    quizState = { ...quizState, status: 'finished', quizId: null, hostId: null, joinCode: null };
    players.clear();
}

io.on('connection', (socket) => {
    socket.emit('quizState', { status: quizState.status, quizName: quizState.quizName });
    io.emit('playerCount', players.size);
    socket.on('join', (playerData) => {
        if (quizState.status !== 'waiting') return socket.emit('error', { message: 'Quiz not ready or already started.' });
        if (playerData.joinCode !== quizState.joinCode) return socket.emit('error', { message: 'Invalid Join Code.' });
        if (Array.from(players.values()).some(p => p.name.toLowerCase() === playerData.name.toLowerCase())) return socket.emit('error', { message: 'Name taken.' });
        players.set(socket.id, { ...playerData, score: 0, answers: {}, questionIndex: -1 });
        io.emit('playerCount', players.size);
        socket.emit('joined', { name: playerData.name });
    });
    socket.on('requestNextQuestion', () => {
        const player = players.get(socket.id);
        if (!player || quizState.status !== 'active') return;
        player.questionIndex++;
        if (player.questionIndex >= quizState.questions.length) socket.emit('quizFinished', { score: player.score });
        else socket.emit('question', { question: quizState.questions[player.questionIndex], index: player.questionIndex });
    });
    socket.on('submitAnswer', ({ optionIndex }) => {
        const player = players.get(socket.id);
        if (!player || !quizState.questions[player.questionIndex]) return;
        const question = quizState.questions[player.questionIndex];
        if (player.answers[question.id] !== undefined) return;
        
        let scoreChange = 0;
        if (optionIndex === question.correctOptionIndex) {
            scoreChange = question.score;
        } else if (optionIndex !== null) {
            scoreChange = -question.negativeScore;
        } else {
            scoreChange = 0; // Timeout = No Change
        }

        player.score += scoreChange;
        player.answers[question.id] = optionIndex;
        socket.emit('answerResult', { isCorrect: optionIndex === question.correctOptionIndex, scoreChange, correctOptionIndex: question.correctOptionIndex, selectedOptionIndex: optionIndex, score: player.score });
        
        const hostDb = getHostDb(quizState.hostId);
        const stmt = hostDb.prepare('INSERT INTO results (quiz_id, name, branch, year, score, finishTime, answers) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(quiz_id, name) DO UPDATE SET score=excluded.score, finishTime=excluded.finishTime, answers=excluded.answers');
        stmt.run(quizState.quizId, player.name, player.branch, player.year, player.score, Date.now(), JSON.stringify(player.answers));
        io.emit('leaderboardUpdate', { results: getHostDb(quizState.hostId).prepare('SELECT name, score FROM results WHERE quiz_id = ? ORDER BY score DESC, finishTime ASC LIMIT 20').all(quizState.quizId), quizName: quizState.quizName });
    });
    socket.on('getLeaderboard', () => {
        if (quizState.hostId) socket.emit('leaderboardUpdate', { results: getHostDb(quizState.hostId).prepare('SELECT name, score FROM results WHERE quiz_id = ? ORDER BY score DESC, finishTime ASC LIMIT 20').all(quizState.quizId), quizName: quizState.quizName });
    });
    socket.on('disconnect', () => { players.delete(socket.id); io.emit('playerCount', players.size); });
});

server.listen(PORT, () => console.log(`🚀 QuizCraft Server running on port ${PORT}`));
