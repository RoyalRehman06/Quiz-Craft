const socket = io();
const body = document.getElementById("leaderboard-body");
const nameEl = document.getElementById("leaderboard-quiz-name");
socket.on("connect", () => socket.emit("getLeaderboard"));
socket.on("leaderboardUpdate", ({ results, quizName }) => {
    nameEl.textContent = quizName || "QuizCraft";
    const rankColors = ['rank-1', 'rank-2', 'rank-3'];
    body.innerHTML = results.map((r, i) => `
        <tr class="border-b border-[#444]">
            <td class="p-4 text-2xl font-black ${rankColors[i] || 'text-white/80'}">#${i + 1}</td>
            <td class="p-4 text-xl">${r.name}</td>
            <td class="p-4 text-xl font-black text-yellow-400 text-right">${r.score}</td>
        </tr>`).join("");
});
