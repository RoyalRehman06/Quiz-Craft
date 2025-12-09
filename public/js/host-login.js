document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const res = await (await fetch("/api/host/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: document.getElementById("email-input").value, password: document.getElementById("password-input").value }) })).json();
    if (res.success) { sessionStorage.setItem("host-token", res.token); window.location.href = "/dashboard"; } else alert("Login failed");
});
