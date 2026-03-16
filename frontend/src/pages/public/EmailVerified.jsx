/*
 * File-ID: UI-4
 * File-Path: frontend/src/pages/public/EmailVerified.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: Handle email verification confirmation
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import logo from "../../assets/pace-bgr.png";

export default function EmailVerified() {

const navigate = useNavigate();

const [status,setStatus] = useState("checking");
const [error,setError] = useState(null);
const [loading,setLoading] = useState(false);

useEffect(()=>{

async function checkVerification(){

try{

const { data: sessionData } = await supabase.auth.getSession();
let session = sessionData?.session;

// Sometimes Supabase needs a moment to parse the URL hash
if (!session) {

  await new Promise(resolve => setTimeout(resolve, 500));

  const retry = await supabase.auth.getSession();
  session = retry?.data?.session;

}

if(!session){
setStatus("not_verified");
return;
}

// Now resolve user
const { data: userData, error } = await supabase.auth.getUser();

if(error){
setStatus("error");
setError(error.message);
return;
}

const user = userData?.user;

if(!user){
setStatus("not_verified");
return;
}

if(!user.email_confirmed_at){
setStatus("not_verified");
return;
}

setStatus("verified");

}catch(err){

setStatus("error");
setError(err.message);

}

}

checkVerification();

},[]);


async function handleContinue(){
    if(loading) return;

setLoading(true);

try{

// Get Supabase session token
const { data } = await supabase.auth.getSession();
const token = data?.session?.access_token;

if(!token){
setError("Session expired. Please try again.");
setLoading(false);
return;
}

const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/signup`,{
method:"POST",
headers:{
"Authorization": `Bearer ${token}`
}
});

if(!res.ok){
throw new Error("Signup API failed");
}

navigate("/signup-submitted");

}catch(err){

setStatus("error");
setError(err instanceof Error ? err.message :"Signup request failed");

}finally{

setLoading(false);

}
}


return(

<div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">

<div className="w-[420px] bg-white rounded-xl shadow-md p-8 text-center">

<div className="flex flex-col items-center">

<div className="w-[360px] mb-4">
<img
src={logo}
className="w-full h-auto"
loading="eager"
/>
</div>

</div>

{status === "checking" && (

<div>

<div className="text-gray-600 mb-4">
Checking verification status...
</div>

</div>

)}

{status === "verified" && (

<div>

<h2 className="text-green-600 text-xl font-semibold mb-4">
Email Verified Successfully
</h2>

<p className="text-gray-600 mb-6">
Your email has been verified. Continue to submit your ERP signup request.
</p>

<button
onClick={handleContinue}
disabled={loading}
className="px-6 py-3 bg-[#1E3A8A] text-white rounded-lg hover:opacity-90 disabled:opacity-60"
>

{loading ? "Submitting..." : "Continue"}

</button>

</div>

)}

{status === "not_verified" && (

<div>

<h2 className="text-red-600 text-xl font-semibold mb-4">
Email Not Verified
</h2>

<p className="text-gray-600 mb-6">
Please verify your email before continuing.
</p>

<button
onClick={()=>navigate("/signup")}
className="px-6 py-3 bg-gray-500 text-white rounded-lg"
>
Back to Signup
</button>

</div>

)}

{status === "error" && (

<div>

<h2 className="text-red-600 text-xl font-semibold mb-4">
Verification Error
</h2>

<p className="text-gray-600">
{error}
</p>

</div>

)}

</div>

</div>

);

}