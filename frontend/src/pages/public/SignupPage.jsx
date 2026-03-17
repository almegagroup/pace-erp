/*
 * File-ID: UI-3
 * File-Path: frontend/src/pages/public/SignupScreen.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP signup screen (Supabase identity creation)
 * Authority: Frontend
 */

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";

import logo from "../../assets/pace-bgr.png";

export default function SignupScreen() {

const navigate = useNavigate();

const [name,setName] = useState("");
const [company,setCompany] = useState("");
const [designation,setDesignation] = useState("");
const [phone,setPhone] = useState("");
const [email,setEmail] = useState("");
const [password,setPassword] = useState("");

const [loading,setLoading] = useState(false);
const [error,setError] = useState(null);
const [success,setSuccess] = useState(false);
const [captchaToken,setCaptchaToken] = useState(null);

useEffect(() => {

  let cancelled = false;

  function renderCaptcha() {

    if (cancelled) return;

    if (!globalThis.turnstile) {
      setTimeout(renderCaptcha, 500);
      return;
    }

    const container = document.getElementById("signup-turnstile");

    if (!container) return;

    if (container.childElementCount > 0) return;

/* NEW LINE */
globalThis.turnstile.remove(container);

globalThis.turnstile.render(container, {

  sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,

  callback: (token) => {
    setCaptchaToken(token);
  },

  "expired-callback": () => {
    setCaptchaToken(null);
  }

});

  }

  renderCaptcha();

  return () => {
    cancelled = true;
  };

}, []);

async function handleSignup(e){

if(e) e.preventDefault();

if(loading) return;

setError(null);

if(!name || !company){
setError("Name and Company are required");
return;
}

if(!email || !password){
setError("Email and password are required");
return;
}

if(!captchaToken){
setError("Please complete captcha");
return;
}

setLoading(true);

try{

  const redirectUrl = import.meta.env.VITE_APP_URL;

const { error } = await supabase.auth.signUp({

email,
password,

options:{

data:{
name: name,
parent_company: company,
designation_hint: designation,
phone: phone
},

emailRedirectTo: `${redirectUrl}/auth/callback`

}

});

if(error){
throw new Error(error.message);
}

setCaptchaToken(null);
setSuccess(true);

}catch(err){

setError(err.message || "Signup failed");

}finally{

setLoading(false);

}

}

return(

<div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">

<div className="w-[380px] bg-white rounded-xl shadow-md p-6 h-[620px] flex flex-col">

{/* Logo */}

<div className="flex flex-col items-center shrink-0">

<div className="w-[360px] mb-1">
<img
src={logo}
className="w-full h-auto"
loading="eager"
/>
</div>

<p className="text-gray-600 text-center mb-6">
Create your ERP account
</p>

</div>

{/* Success State */}

{success ? (

<div className="text-center">

<div className="text-green-600 font-semibold mb-4">
Verification Email Sent
</div>

<p className="text-sm text-gray-600 mb-6">
Please check your email and click the verification link
to continue your ERP signup.
</p>

<div className="flex flex-col gap-3">

<Link
to="/login"
className="text-blue-600 hover:underline"
>
Already verified? Go to Login
</Link>

<button
onClick={()=>navigate("/")}
className="text-gray-600 hover:underline"
>
Back to Landing Page
</button>

</div>

</div>

) : (

<div className="flex-1 overflow-y-auto mt-2">
<form onSubmit={handleSignup}>

{/* Name */}

<div className="mb-3">

<input
type="text"
placeholder="Full Name"
value={name}
onChange={(e)=>setName(e.target.value)}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

</div>

{/* Company */}

<div className="mb-3">

<input
type="text"
placeholder="Parent Company"
value={company}
onChange={(e)=>setCompany(e.target.value)}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

</div>

{/* Designation */}

<div className="mb-3">

<input
type="text"
placeholder="Designation (optional)"
value={designation}
onChange={(e)=>setDesignation(e.target.value)}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

</div>

{/* Phone */}

<div className="mb-3">

<input
type="text"
placeholder="Phone Number"
value={phone}
onChange={(e)=>setPhone(e.target.value)}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

</div>

{/* Email */}

<div className="mb-3">

<input
type="email"
placeholder="Email"
value={email}
onChange={(e)=>setEmail(e.target.value)}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

</div>

{/* Password */}

<div className="mb-4">

<input
type="password"
placeholder="Password"
value={password}
onChange={(e)=>setPassword(e.target.value)}
className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
/>

</div>
{/* CAPTCHA */}

<div className="mb-4 flex justify-center">
  <div id="signup-turnstile"></div>
</div>



{/* Error */}

{error && (

<div className="text-red-600 text-sm mb-4 text-center">
{error}
</div>

)}

{/* Submit */}

<button
type="submit"
disabled={loading}
className="w-full py-3 bg-[#1E3A8A] text-white rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60"
>

{loading && (

<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>

)}

{loading ? "Creating account..." : "Create Account"}

</button>

{/* Cancel Button */}

<button
type="button"
onClick={()=>navigate("/")}
className="w-full mt-3 text-gray-600 hover:underline"
>
Cancel
</button>

</form>
</div>

)}

{/* Footer Links */}

<div className="text-center text-sm text-gray-600 mt-5">

Already have an account?{" "}

<Link to="/login" className="text-blue-600 hover:underline">
Login
</Link>

</div>

<div className="text-center text-xs text-gray-400 mt-6">
© Almega Group
</div>

</div>

</div>

);

}