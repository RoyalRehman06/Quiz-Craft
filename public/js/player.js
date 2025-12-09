const socket = io();
const ui = {
    joinPage: document.getElementById("join-page"), waitingPage: document.getElementById("waiting-page"), quizPage: document.getElementById("quiz-page"), finishedPage: document.getElementById("finished-page"),
    joinError: document.getElementById("join-error"), welcomeMessage: document.getElementById("welcome-message"), quizTitle: document.getElementById("quiz-title-display"),
    questionText: document.getElementById("question-text"), questionImage: document.getElementById("question-image"), optionsContainer: document.getElementById("options-container"),
    timerDisplay: document.getElementById("timer-display"), questionScoreDisplay: document.getElementById("question-score-display"), scoreDisplay: document.getElementById("score-display"),
    feedbackContainer: document.getElementById("feedback-container"), feedbackText: document.getElementById("feedback-text"), feedbackScore: document.getElementById("feedback-score"),
    nextQuestionBtn: document.getElementById("next-question-btn"), finalScore: document.getElementById("final-score"), playerCount: document.getElementById("player-count-display")
};
let timerInterval;

function showPage(pageId) {
    ["join-page", "waiting-page", "quiz-page", "finished-page"].forEach(id => document.getElementById(id).classList.add("hide"));
    document.getElementById(pageId).classList.remove("hide");
}

document.getElementById("join-form").addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("name-input").value.trim();
    const joinCode = document.getElementById("joincode-input").value.trim().toUpperCase();
    if (name && joinCode) socket.emit("join", { name, branch: document.getElementById("branch-input").value.trim(), year: document.getElementById("year-input").value.trim(), joinCode });
});

ui.nextQuestionBtn.addEventListener("click", () => socket.emit("requestNextQuestion"));

socket.on("joined", ({ name }) => { ui.welcomeMessage.textContent = `Welcome, ${name}!`; showPage("waiting-page"); });
socket.on("quizState", state => { ui.quizTitle.textContent = state.quizName || "QuizCraft"; });
socket.on("playerCount", count => { ui.playerCount.textContent = `Players: ${count}`; });
socket.on("error", ({ message }) => { ui.joinError.textContent = message; ui.joinError.classList.remove("hide"); });
socket.on("quizStarted", state => { ui.quizTitle.textContent = state.quizName; showPage("quiz-page"); socket.emit("requestNextQuestion"); });

socket.on("question", ({ question, index }) => {
    ui.feedbackContainer.classList.add("hide");
    ui.questionText.textContent = `${index + 1}. ${question.text}`;
    ui.questionScoreDisplay.textContent = `POINTS: ${question.score} / NEGATIVE: ${question.negativeScore}`;
    ui.questionImage.src = question.imageUrl ? question.imageUrl : "";
    question.imageUrl ? ui.questionImage.classList.remove("hide") : ui.questionImage.classList.add("hide");

    ui.optionsContainer.innerHTML = "";
    JSON.parse(question.options).forEach((optionText, optionIndex) => {
        const button = document.createElement("button");
        button.className = "option-btn";
        button.textContent = optionText;
        button.onclick = () => submitAnswer(optionIndex);
        ui.optionsContainer.appendChild(button);
    });

    clearInterval(timerInterval);
    let timeLeft = question.timeLimit;
    ui.timerDisplay.textContent = `${timeLeft}s`;
    
    timerInterval = setInterval(() => {
        timeLeft--;
        ui.timerDisplay.textContent = `${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (!ui.optionsContainer.querySelector('button:disabled')) {
                submitAnswer(null);
            }
            setTimeout(() => {
                socket.emit("requestNextQuestion");
            }, 1200);
        }
    }, 1000);
});

socket.on("answerResult", ({ isCorrect, scoreChange, correctOptionIndex, selectedOptionIndex, score }) => {
    ui.scoreDisplay.textContent = score;
    ui.feedbackContainer.classList.remove("hide");
    ui.nextQuestionBtn.focus();
    ui.feedbackText.textContent = isCorrect ? "CORRECT!" : "WRONG!";
    ui.feedbackText.className = isCorrect ? "text-3xl font-black mb-2 text-green-500" : "text-3xl font-black mb-2 text-red-500";
    
    if (selectedOptionIndex === null) {
        ui.feedbackText.textContent = "TIME UP!";
        ui.feedbackText.className = "text-3xl font-black mb-2 text-yellow-500";
    }

    ui.feedbackScore.textContent = `SCORE: ${scoreChange > 0 ? "+" : ""}${scoreChange}`;
    ui.optionsContainer.querySelectorAll("button").forEach((button, index) => {
        if (index === correctOptionIndex) { button.style.backgroundColor = "rgba(22, 163, 74, 0.8)"; button.style.borderColor = "#22c55e"; }
        else if (index === selectedOptionIndex) { button.style.backgroundColor = "rgba(220, 38, 38, 0.8)"; button.style.borderColor = "#ef4444"; }
        else button.style.opacity = "0.5";
    });
});

socket.on("quizFinished", ({ score }) => { ui.finalScore.textContent = score; showPage("finished-page"); });

function submitAnswer(optionIndex) {
    ui.optionsContainer.querySelectorAll("button").forEach(btn => btn.disabled = true);
    socket.emit("submitAnswer", { optionIndex });
}
