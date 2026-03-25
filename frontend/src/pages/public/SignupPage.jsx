/*
 * File-ID: UI-3
 * File-Path: frontend/src/pages/public/SignupScreen.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP signup screen (Supabase identity creation)
 * Authority: Frontend
 */

import { useState, useEffect, useRef } from "react";
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
const passwordStrength = getPasswordStrength(password);

const [loading,setLoading] = useState(false);
const [error,setError] = useState(null);
const [fieldErrors, setFieldErrors] = useState({});
const [success,setSuccess] = useState(false);
const [captchaToken,setCaptchaToken] = useState(null);

const widgetIdRef = useRef(null);
// 🔥 VALIDATION HELPERS

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return /^[0-9]{10}$/.test(phone);
}

function getPasswordStrength(password) {
  let score = 0;

  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return score; // 0–4
}

function isValidPassword(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

useEffect(() => {

  let cancelled = false;
  let retryCount = 0;

  function renderCaptcha() {

    if (cancelled) return;

    if (!globalThis.turnstile) {
      if (retryCount < 10) {
        retryCount++;
        setTimeout(renderCaptcha, 500);
      }
      return;
    }

    const container = document.getElementById("signup-turnstile");
    if (!container) return;

    if (!container.hasChildNodes()) {
      widgetIdRef.current = globalThis.turnstile.render(container, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,

        callback: (token) => {
          setCaptchaToken(token);
        },

        "expired-callback": () => {
          setCaptchaToken(null);
        }
      });
    }
  }

  renderCaptcha();

  return () => {
    cancelled = true;

    if (widgetIdRef.current && globalThis.turnstile) {
      globalThis.turnstile.remove(widgetIdRef.current);
    }
  };

}, []);
function validateFields() {
  const errors = {};

  if (!name) errors.name = "Name is required";

  if (!company) errors.company = "Company is required";

  if (!email) {
    errors.email = "Email is required";
  } else if (!isValidEmail(email)) {
    errors.email = "Invalid email format";
  }

  if (!phone) {
    errors.phone = "Phone is required";
  } else if (!isValidPhone(phone)) {
    errors.phone = "Phone must be 10 digits";
  }

  if (!password) {
    errors.password = "Password is required";
  } else if (!isValidPassword(password)) {
    errors.password =
      "8+ chars, 1 Capital, 1 Number, 1 Special required";
  }

  return errors;
}


async function handleSignup(e){

if(e) e.preventDefault();

if(loading) return;

// 🔥 RATE LIMIT START
const lastSignup = localStorage.getItem("signup_attempt");

if(lastSignup){
  const diff = Date.now() - Number(lastSignup);

  if(diff < 10000){
    setError("Please wait before trying again");
    return;
  }
}

localStorage.setItem("signup_attempt", Date.now());
// 🔥 RATE LIMIT END

setError(null);

const errors = validateFields();
setFieldErrors(errors);

if (Object.keys(errors).length > 0) {
  return;
}

// 🔥 BASIC REQUIRED CHECK
if (!name || !company) {
  setError("Name and Company are required");
  return;
}

if (!email || !password || !phone) {
  setError("Email, Phone and Password are required");
  return;
}

// 🔥 EMAIL VALIDATION
if (!isValidEmail(email)) {
  setError("Invalid email format");
  return;
}

// 🔥 PHONE VALIDATION (10 digit)
if (!isValidPhone(phone)) {
  setError("Phone must be 10 digits");
  return;
}

// 🔥 PASSWORD VALIDATION
if (!isValidPassword(password)) {
  setError("Password must be 8+ chars with 1 Capital, 1 Number, 1 Special Character");
  return;
}


if(!captchaToken){
  setError("Please complete captcha");
  return;
}

// 🔥 OPTIONAL STRONG CHECK (recommended)
if(captchaToken.length < 10){
  setError("Invalid captcha");
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

setSuccess(true);

// 🔥 optional cleanup (safer)
setCaptchaToken(null);

if (globalThis.turnstile && widgetIdRef.current) {
  try {
    globalThis.turnstile.remove(widgetIdRef.current);
    widgetIdRef.current = null;
  } catch(e) {
  console.error(e);
}
}

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
className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 ${
  fieldErrors.name ? "border-red-500" : "focus:ring-blue-600"
}`}
/>
{fieldErrors.name && (
  <p className="text-red-600 text-xs mt-1">
    {fieldErrors.name}
  </p>
)}
</div>

{/* Company */}

<div className="mb-3">

<input
type="text"
placeholder="Parent Company"
value={company}
onChange={(e)=>setCompany(e.target.value)}
className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 ${
  fieldErrors.company ? "border-red-500" : "focus:ring-blue-600"
}`}
/>

{fieldErrors.company && (
  <p className="text-red-600 text-xs mt-1">
    {fieldErrors.company}
  </p>
)}

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
className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 ${
  fieldErrors.phone ? "border-red-500" : "focus:ring-blue-600"
}`}
/>

{fieldErrors.phone && (
  <p className="text-red-600 text-xs mt-1">
    {fieldErrors.phone}
  </p>
)}

</div>

{/* Email */}

<div className="mb-3">

<input
type="email"
placeholder="Email"
value={email}
onChange={(e)=>setEmail(e.target.value)}
className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 ${
  fieldErrors.email ? "border-red-500" : "focus:ring-blue-600"
}`}
/>

{fieldErrors.email && (
  <p className="text-red-600 text-xs mt-1">
    {fieldErrors.email}
  </p>
)}

</div>

{/* Password */}

<div className="mb-4">

<input
type="password"
placeholder="Password"
value={password}
onChange={(e)=>setPassword(e.target.value)}
className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 ${
  fieldErrors.password ? "border-red-500" : "focus:ring-blue-600"
}`}
/>

{fieldErrors.password && (
  <p className="text-red-600 text-xs mt-1">
    {fieldErrors.password}
  </p>
)}

{/* 🔥 Strength Bar */}

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