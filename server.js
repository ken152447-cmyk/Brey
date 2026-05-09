const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let waiting = [];
let rooms = new Map();
let blocks = new Map();

function isOpenTime() {
  const h = new Date().getHours();
  return h >= 22 && h < 24;
}

function score(a, b) {
  let point = 0;

  const ah = a.hobbies || [];
  const bh = b.hobbies || [];

  ah.forEach(h => {
    if (bh.includes(h)) point += 2;
  });

  if (a.age && b.age && a.age === b.age) {
    point += 3;
  }

  return point;
}

function isBlocked(a, b) {
  return blocks.get(a)?.has(b) || blocks.get(b)?.has(a);
}

function removeFromWaiting(socketId) {
  waiting = waiting.filter(w => w.socket.id !== socketId);
}

function findRoomBySocket(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.sockets.includes(socketId)) {
      return { roomId, room };
    }
  }
  return null;
}

io.on("connection", (socket) => {
  console.log("connect", socket.id);

  socket.on("joinWave", (user) => {
    if (!user.forceOpen && !isOpenTime()) {
      socket.emit("closed");
      return;
    }

    removeFromWaiting(socket.id);

    const me = {
      socket,
      user,
      joinedAt: Date.now()
    };

    const candidates = waiting
      .filter(w => w.user.userId !== user.userId)
      .filter(w => !isBlocked(user.userId, w.user.userId))
      .sort((a, b) => score(user, b.user) - score(user, a.user));

    const partner = candidates[0];

    if (!partner) {
      waiting.push(me);
      socket.emit("waiting");
      return;
    }

    removeFromWaiting(partner.socket.id);

    const roomId = "room-" + Date.now();

    socket.join(roomId);
    partner.socket.join(roomId);

    rooms.set(roomId, {
      sockets: [socket.id, partner.socket.id],
      profiles: [user, partner.user],
      start: Date.now()
    });

    io.to(roomId).emit("matched", {
      roomId,
      users: [user, partner.user]
    });
  });

  socket.on("message", ({ roomId, text }) => {
    socket.to(roomId).emit("message", text);
  });

  socket.on("typing", (roomId) => {
    socket.to(roomId).emit("typing");
  });

  socket.on("exchangeChoice", ({ roomId, choice }) => {
    socket.to(roomId).emit("exchangeChoice", choice);
  });

  socket.on("report", ({ roomId, reporterId, reportedId }) => {
    console.log("REPORT", { roomId, reporterId, reportedId });
    socket.to(roomId).emit("partnerLeft");
    rooms.delete(roomId);
  });

  socket.on("block", ({ blockerId, blockedId }) => {
    if (!blocks.has(blockerId)) {
      blocks.set(blockerId, new Set());
    }
    blocks.get(blockerId).add(blockedId);
  });

  socket.on("leaveRoom", (roomId) => {
    socket.to(roomId).emit("partnerLeft");
    rooms.delete(roomId);
  });

  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);

    removeFromWaiting(socket.id);

    const found = findRoomBySocket(socket.id);

    if (found) {
      socket.to(found.roomId).emit("partnerLeft");
      rooms.delete(found.roomId);
    }
  });
});

setInterval(() => {
  const now = Date.now();

  waiting = waiting.filter(w => {
    return now - w.joinedAt < 5 * 60 * 1000;
  });

  for (const [roomId, room] of rooms.entries()) {
    if (now - room.start > 15 * 60 * 1000) {
      io.to(roomId).emit("partnerLeft");
      rooms.delete(roomId);
    }
  }
}, 30 * 1000);

server.listen(3000, () => {
  console.log("Brey server running on http://localhost:3000");
});
