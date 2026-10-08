const { verifyToken } = require("../services/auth.service");
const {
  advancePlayer,
  getMatchForPlayer,
  setMatchBroadcaster,
  submitAnswer,
} = require("../services/match.service");

function registerMatchSocketHandlers(io) {
  setMatchBroadcaster(async (matchId, userId, state) => {
    const sockets = await io.in(`match:${matchId}`).fetchSockets();
    for (const roomSocket of sockets) {
      if (String(roomSocket.data.user?.sub) === String(userId)) {
        roomSocket.emit("match:state", state);
      }
    }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required."));
    try {
      socket.data.user = verifyToken(token);
      return next();
    } catch {
      return next(new Error("Invalid or expired session."));
    }
  });

  io.on("connection", (socket) => {
    socket.on("match:join", async ({ matchId } = {}, acknowledge = () => {}) => {
      try {
        const state = await getMatchForPlayer(matchId, socket.data.user.sub);
        socket.join(`match:${matchId}`);
        acknowledge({ ok: true, match: state });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });

    socket.on(
      "match:answer",
      async ({ matchId, selectedOption } = {}, acknowledge = () => {}) => {
        try {
          await submitAnswer(matchId, Number(socket.data.user.sub), selectedOption);
          const state = await getMatchForPlayer(matchId, socket.data.user.sub);
          acknowledge({ ok: true, match: state });
        } catch (error) {
          acknowledge({ ok: false, error: error.message });
        }
      },
    );

    socket.on("match:next", async ({ matchId } = {}, acknowledge = () => {}) => {
      try {
        await advancePlayer(matchId, Number(socket.data.user.sub));
        const state = await getMatchForPlayer(matchId, socket.data.user.sub);
        acknowledge({ ok: true, match: state });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });
  });
}

module.exports = { registerMatchSocketHandlers };
