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

export default function EmailVerified() {

const navigate = useNavigate();

const [status,setStatus] = useState("checking");
const [error,setError] = useState(null);

useEffect(()=>{

async function checkVerification(){

try{

const { data, error } = await supabase.auth.getUser();

if(error){
setStatus("error");
setError(error.message);
return;
}

const user = data?.user;

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

try{

// Get Supabase session token
const { data } = await supabase.auth.getSession();
const token = data.session?.access_token;

const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/signup`,{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization": `Bearer ${token}`
},
body: JSON.stringify({})
});

if(!res.ok){
throw new Error("Signup API failed");
}

navigate("/signup-submitted");

}catch(err){

setError("Signup request failed");

}

}


return(

<div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">

<div className="w-[420px] bg-white rounded-xl shadow-md p-8 text-center">

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
className="px-6 py-3 bg-[#1E3A8A] text-white rounded-lg hover:opacity-90"
>
Continue
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