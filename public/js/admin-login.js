document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const res = await (await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: document.getElementById("password-input").value }) })).json();
    if (res.success) { sessionStorage.setItem("admin-token", res.token); window.location.href = "/admin/dashboard"; } else alert("Login failed");
});
