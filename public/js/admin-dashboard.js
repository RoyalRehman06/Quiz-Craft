let adminToken = sessionStorage.getItem("admin-token");
async function api(ep, body) {
    const headers = { "Content-Type": "application/json" }; if (adminToken) headers.Authorization = adminToken;
    return await (await fetch(`/api/admin/${ep}`, { method: "POST", headers, body: JSON.stringify(body) })).json();
}
function logout() { sessionStorage.removeItem("admin-token"); window.location.href = "/admin"; }
async function refreshHosts() {
    const res = await api("hosts");
    if (res.success) document.getElementById("host-list-table").innerHTML = res.hosts.map(h => `
        <tr class="border-b">
            <td class="p-3 font-bold">#${h.id}</td>
            <td class="p-3">${h.email}</td>
            <td class="p-3">
                <button class="text-blue-500 font-semibold mr-3" onclick="changePass(${h.id})">Change Password</button>
                <button class="text-red-500 font-semibold" onclick="deleteHost(${h.id})">Delete</button>
            </td>
        </tr>`).join(""); else logout();
}
async function deleteHost(id) { if (confirm("Delete host?")) if ((await api("delete-host", { hostId: id })).success) refreshHosts(); }

// ** Change Password Logic **
window.changePass = async (id) => {
    const newPass = prompt("Enter new password for this host:");
    if (newPass) {
        const res = await api("update-host-password", { hostId: id, newPassword: newPass });
        if (res.success) alert("Password updated successfully");
        else alert("Error updating password");
    }
};

document.getElementById("create-host-form").addEventListener("submit", async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target).entries()); if ((await api("add-host", d)).success) { e.target.reset(); refreshHosts(); } else alert("Error"); });
document.getElementById("logout-btn").addEventListener("click", logout);
adminToken ? refreshHosts() : window.location.href = "/admin";
