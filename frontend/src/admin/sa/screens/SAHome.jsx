import { useNavigate } from "react-router-dom";

export default function SAHome() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: "20px" }}>
      <h2>Super Admin Dashboard</h2>

      <button onClick={() => navigate("/sa/company/create")}>
        Create Company
      </button>

      <br /><br />

      <button onClick={() => navigate("/sa/users")}>
        Users
      </button>

      <br /><br />

      <button onClick={() => navigate("/sa/signup-requests")}>
        Signup Requests
      </button>
    </div>
  );
}