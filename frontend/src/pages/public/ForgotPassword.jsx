

/*
 * File-ID: UI-6
 * File-Path: frontend/src/pages/public/ForgotPassword.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP forgot password screen
 * Authority: Frontend
 *
 * NOTE:
 * * Uses Supabase Auth password reset flow
 * * No ERP backend/API required
 * * No ERP DB interaction required
 * * Prevents email enumeration
 */



import { useState } from "react";
import { Link } from "react-router-dom";
import logo from "../../assets/pace-bgr.png";
import { supabase } from "../../lib/supabaseClient.js";

export default function ForgotPassword() {

const [email,setEmail] = useState("");
const [loading,setLoading] = useState(false);
const [error,setError] = useState(null);
const [success,setSuccess] = useState(false);

async function handleSubmit(e){

if(e) e.preventDefault();
if(loading) return;

if(!email){
setError("Please enter your email address");
return;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if(!emailRegex.test(email)){
setError("Please enter a valid email address");
return;
}

setError(null);
setLoading(true);

try{

const { error } = await supabase.auth.resetPasswordForEmail(email,{
redirectTo: `${globalThis.location.origin}/auth/callback?flow=recovery`
});

if(error) throw error;

setSuccess(true);

}catch{

setSuccess(true);

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

<p className="text-gray-600 text-center mb-2">
Forgot your password?
</p>

<p className="text-sm text-gray-500 text-center mb-6">
Enter your email and we will send you a reset link.
</p>

</div>

<form onSubmit={handleSubmit}>

<div className="mb-4">

<input
type="email"
placeholder="Enter your email"
value={email}
onChange={(e)=>setEmail(e.target.value)}
disabled={loading}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

</div>

{error && (
<div className="text-red-600 text-sm mb-4 text-center">
{error}
</div>
)}

{success && (
<div className="text-green-600 text-sm mb-4 text-center">
If an account exists for this email, a reset link has been sent.
</div>
)}

<button
type="submit"
disabled={loading}
className="w-full py-3 bg-[#1E3A8A] text-white rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60"
>

{loading ? "Sending..." : "Send Reset Link"}

</button>

</form>

<div className="flex justify-between mt-5 text-sm text-gray-600">

<Link to="/login" className="hover:underline">
Back to Login
</Link>

<Link to="/signup" className="hover:underline">
Create Account
</Link>

</div>

<div className="text-center text-xs text-gray-400 mt-6">
© Almega Group
</div>

</div>

</div>

);

}