/*
* File-ID: UI-2
* File-Path: frontend/src/pages/public/LoginScreen.jsx
* Gate: UI
* Phase: Public
* Domain: FRONT
* Purpose: ERP authentication screen
* Authority: Frontend
*
* NOTE:
* Login API wired
* Session verification via /api/me
* Universe resolution via /api/me/menu
* Redirect SSOT compliant
*/

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

import logo from "../../assets/pace-bgr.png";

export default function LoginScreen() {

const navigate = useNavigate();

/* ===============================
STATE
================================ */

const [identifier,setIdentifier]=useState("");
const [password,setPassword]=useState("");

const [loading,setLoading]=useState(false);
const [error,setError]=useState(null);
const [showPassword,setShowPassword]=useState(false);

/* ===============================
LOGIN HANDLER
================================ */

async function handleLogin(e){

if(e) e.preventDefault();

if(loading) return;

/* Prevent empty submit */

if(!identifier || !password){
setError("Please enter identifier and password");
return;
}

setError(null);
setLoading(true);

try{

/* ===============================
STEP 1 — LOGIN REQUEST
================================ */

const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/login`, {

method:"POST",

credentials:"include",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
identifier,
password
})

});

const loginData = await res.json();


if(!res.ok || !loginData?.ok){
  throw new Error("INVALID_LOGIN");
}

// ✅ UNIVERSAL ENTRY POINT
navigate("/dashboard");

}catch(err){

  let message = "Login failed";
  const code = err?.message || "UNKNOWN";

  if(code === "INVALID_LOGIN"){
    message = "Invalid UserID or password";
  }
 

  setError(`${message} (${code})`);
}

finally{

setLoading(false);

}

}

/*enter*/

/* ===============================
ENTER KEY SUBMIT
================================ */

function handleKeyDown(e){

if(e.key==="Enter"){
handleLogin();
}

}

/* ===============================
UI
================================ */

return(

<div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">

<div className="w-[360px] bg-white rounded-xl shadow-md p-8">

{/* Logo + Tagline */}

<div className="flex flex-col items-center">

<div className="w-[400px] mb-4">
<img
src={logo}
className="w-full h-auto"
loading="eager"
/>
</div>

<p className="text-gray-600 text-center mb-6">
Process Automation & Control Environment
</p>

</div>

{/* ===============================
LOGIN FORM
================================ */}

<form onSubmit={handleLogin}>

{/* Identifier */}

<div className="mb-4">

<input

type="text"

placeholder="Email or User ID (e.g. erp@company.com / P000X)"

value={identifier}

onChange={(e)=>setIdentifier(e.target.value)}

onKeyDown={handleKeyDown}

disabled={loading}

className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"

/>

</div>

{/* Password */}

<div className="mb-4 relative">

<input

type={showPassword?"text":"password"}

placeholder="Password"

value={password}

onChange={(e)=>setPassword(e.target.value)}

onKeyDown={handleKeyDown}

disabled={loading}

className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"

/>

<button

type="button"

onClick={()=>setShowPassword(!showPassword)}

className="absolute right-3 top-3 text-sm text-gray-500"

>

{showPassword?"Hide":"Show"}

</button>

</div>

{/* Error Message */}

{error && (

<div className="text-red-600 text-sm mb-4 text-center">

{error}

</div>

)}

{/* Login Button */}

<button

type="submit"

disabled={loading}

className="w-full py-3 bg-[#1E3A8A] text-white rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60"

>

{loading && (

<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>

)}

{loading ? "Logging in..." : "Login"}

</button>

</form>

{/* ===============================
AUTH LINKS
================================ */}

<div className="flex justify-between mt-5 text-sm text-gray-600">

<Link to="/forgot-password" className="hover:underline">
Forgot Password?
</Link>

<Link to="/signup" className="hover:underline">
Create Account
</Link>

</div>

{/* Footer */}

<div className="text-center text-xs text-gray-400 mt-6">
© Almega Group
</div>

</div>

</div>

);

}