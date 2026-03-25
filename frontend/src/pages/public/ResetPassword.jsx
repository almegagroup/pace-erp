/*
 * File-ID: UI-7
 * File-Path: frontend/src/pages/public/ResetPassword.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP reset password screen
 * Authority: Frontend
 *
 * NOTE:
 * * Triggered from Supabase email recovery link
 * * Uses Supabase Auth updateUser
 * * No ERP backend/API required
 */

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import logo from "../../assets/pace-bgr.png";
import { supabase } from "../../lib/supabaseClient.js";

function getPasswordStrength(password) {
  let score = 0;

  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return score;
}

function isValidPassword(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}



export default function ResetPassword(){

const navigate = useNavigate();

const [password,setPassword] = useState("");
const [confirm,setConfirm] = useState("");
const passwordStrength = getPasswordStrength(password);
const [showPassword,setShowPassword] = useState(false);
const [showConfirm,setShowConfirm] = useState(false);

const [loading,setLoading] = useState(false);
const [error,setError] = useState(null);
const [success,setSuccess] = useState(false);

/* restore recovery session */

useEffect(()=>{

async function checkSession(){

  const { data } = await supabase.auth.getSession();

  const session = data?.session;

 if(!session){
  // wait a bit before failing (race condition fix)
  setTimeout(async () => {
    const { data } = await supabase.auth.getSession();
    if(!data?.session){
      setError("Invalid or expired reset link");
    }
  }, 500);
}

}

checkSession();

},[]);

async function handleReset(e){

if(e) e.preventDefault();
if(loading) return;

/* ✅ ADD THIS BLOCK */
const { data } = await supabase.auth.getSession();
const session = data?.session;

if(!session){
setError("Session expired. Please request a new reset link.");
return;
}

/* existing validations */

if(!password || !confirm){
setError("Please enter password");
return;
}

if(password !== confirm){
setError("Passwords do not match");
return;
}

if(!isValidPassword(password)){
setError("8+ chars, 1 Capital, 1 Number, 1 Special required");
return;
}

setError(null);
setLoading(true);

try{

const { error } = await supabase.auth.updateUser({
password
});

if(error) throw error;

setSuccess(true);

setTimeout(()=>{

navigate("/login");

},2000);

}catch(err){

setError(err?.message || "Unable to reset password");

}finally{

setLoading(false);

}

}

return(

<div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">

<div className="w-[360px] bg-white rounded-xl shadow-md p-8">

<div className="flex flex-col items-center">

<div className="w-[360px] mb-4">
<img
src={logo}
className="w-full h-auto"
loading="eager"
/>
</div>

<p className="text-gray-600 text-center mb-6">
Reset your password
</p>

</div>

<form onSubmit={handleReset}>

<div className="mb-4">

<div className="relative">

<input
type={showPassword ? "text" : "password"}
placeholder="New password"
value={password}
onChange={(e)=>{
  setPassword(e.target.value);
  setError(null);
}}
disabled={loading}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

<button
type="button"
onClick={()=>setShowPassword(prev=>!prev)}
className="absolute right-3 top-3 text-gray-500 text-sm"
>
{showPassword ? "Hide" : "Show"}
</button>

</div>
<div className="mt-2">

<div className="h-2 w-full bg-gray-200 rounded">

<div
className={`h-2 rounded transition-all duration-300 ${
  passwordStrength <= 1
    ? "bg-red-500 w-1/4"
    : passwordStrength === 2
    ? "bg-yellow-500 w-2/4"
    : passwordStrength === 3
    ? "bg-blue-500 w-3/4"
    : "bg-green-500 w-full"
}`}
></div>

</div>

<p className="text-xs mt-1 text-gray-600">
  {passwordStrength <= 1
    ? "Weak password"
    : passwordStrength === 2
    ? "Medium strength"
    : passwordStrength === 3
    ? "Good password"
    : "Strong password"}
</p>

</div>


</div>

<div className="mb-4">

<div className="relative">

<input
type={showConfirm ? "text" : "password"}
placeholder="Confirm password"
value={confirm}
onChange={(e)=>{
  setConfirm(e.target.value);
  setError(null);
}}
disabled={loading}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

<button
type="button"
onClick={()=>setShowConfirm(prev=>!prev)}
className="absolute right-3 top-3 text-gray-500 text-sm"
>
{showConfirm ? "Hide" : "Show"}
</button>

</div>

</div>

{error && (
<div className="text-red-600 text-sm mb-4 text-center">
{error}
</div>
)}

{success && (
<div className="text-green-600 text-sm mb-4 text-center">
Password reset successful. Redirecting to login...
</div>
)}

<button
type="submit"
disabled={loading || success}
className="w-full py-3 bg-[#1E3A8A] text-white rounded-lg hover:opacity-90 transition disabled:opacity-60"
>

{loading ? "Resetting..." : "Reset Password"}

</button>

</form>

<div className="flex justify-between mt-5 text-sm text-gray-600">

<Link to="/login">Back to Login</Link>

<Link to="/signup">Create Account</Link>

</div>

<div className="text-center text-xs text-gray-400 mt-6">
© Almega Group
</div>

</div>

</div>

);

}