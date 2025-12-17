const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DB_FILE = 'db.json';

// --- QUẢN LÝ DATABASE ---
function loadDB() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        const defaultDB = { rooms: {} };
        saveDB(defaultDB);
        return defaultDB;
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Bộ nhớ RAM để lưu ai đang ở trong phòng nào (Socket ID -> Role)
// Cấu trúc: { "roomCode": { "socketID": "X", ... } }
let activePlayers = {}; 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. SỰ KIỆN: NGƯỜI DÙNG NHẬP MÃ ĐỂ VÀO PHÒNG
    socket.on('joinRoom', (roomCode) => {
        // Chuẩn hóa mã phòng (viết hoa, xóa khoảng trắng)
        const code = roomCode.trim().toUpperCase();
        if (!code) return;

        socket.join(code); // Join kênh socket riêng
        
        // Load DB
        let db = loadDB();
        
        // Nếu phòng chưa có trong DB, tạo mới
        if (!db.rooms[code]) {
            db.rooms[code] = {
                board: {},
                currentPlayer: 'X',
                history: [],
                isGameActive: true
            };
            saveDB(db);
        }

        // --- XẾP CHỖ (X hay O) ---
        if (!activePlayers[code]) activePlayers[code] = {};
        
        const roomSockets = activePlayers[code];
        const existingRoles = Object.values(roomSockets); // ['X'] hoặc ['X', 'O']
        
        let myRole = 'Spectator';

        if (!existingRoles.includes('X')) {
            myRole = 'X';
        } else if (!existingRoles.includes('O')) {
            myRole = 'O';
        }

        // Lưu vai trò vào RAM
        if (myRole !== 'Spectator') {
            activePlayers[code][socket.id] = myRole;
        }

        // Gửi thông tin lại cho Client
        socket.emit('roomJoined', {
            roomCode: code,
            role: myRole,
            roomData: db.rooms[code]
        });

        console.log(`Socket ${socket.id} joined room ${code} as ${myRole}`);
    });

    // 2. SỰ KIỆN: ĐÁNH CỜ
    socket.on('move', (data) => {
        const { roomCode, r, c } = data;
        let db = loadDB();
        let room = db.rooms[roomCode];

        // Validate
        if (!room || !room.isGameActive) return;
        
        // Lấy role hiện tại của socket này từ RAM
        const myRole = activePlayers[roomCode]?.[socket.id];
        if (!myRole || myRole === 'Spectator') return; // Khán giả không được đánh
        if (room.currentPlayer !== myRole) return; // Chưa đến lượt

        const key = `${r}-${c}`;
        if (room.board[key]) return; // Ô đã đánh

        // Update DB
        room.board[key] = myRole;
        room.currentPlayer = myRole === 'X' ? 'O' : 'X';
        room.history.push({ r, c, player: myRole }); // (Optional)

        saveDB(db);

        // Gửi cho TOÀN BỘ người trong phòng này
        io.to(roomCode).emit('updateMove', {
            r, c, 
            player: myRole,
            nextTurn: room.currentPlayer
        });
    });

    // 3. SỰ KIỆN: RESET GAME
    socket.on('reset', (roomCode) => {
        let db = loadDB();
        if (db.rooms[roomCode]) {
            db.rooms[roomCode] = {
                board: {},
                currentPlayer: 'X',
                history: [],
                isGameActive: true
            };
            saveDB(db);
            io.to(roomCode).emit('gameReset');
        }
    });

    // 4. NGẮT KẾT NỐI
    socket.on('disconnect', () => {
        // Tìm xem user này đang ở phòng nào để xóa khỏi RAM
        for (const code in activePlayers) {
            if (activePlayers[code][socket.id]) {
                delete activePlayers[code][socket.id];
                // Nếu phòng trống thì có thể xóa activePlayers[code] để dọn rác (tùy chọn)
                break;
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('Server chạy tại port 3000');
});