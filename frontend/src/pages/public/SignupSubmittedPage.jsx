/*
 * File-ID: UI-5
 * File-Path: frontend/src/pages/public/SignupSubmittedPage.jsx
 * Gate: UI
 * Phase: Public
 * Domain: FRONT
 * Purpose: ERP signup request submitted confirmation
 * Authority: Frontend
 */

import { useNavigate } from "react-router-dom";
import logo from "../../assets/pace-bgr.png";

export default function SignupSubmittedPage(){

const navigate = useNavigate();

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

<h2 className="text-green-600 text-xl font-semibold mb-4">
Signup Request Submitted
</h2>

<p className="text-gray-600 mb-6">

Your ERP account request has been submitted successfully.

<br/><br/>

An administrator will review and approve your account before access is granted.

</p>

<button
onClick={()=>navigate("/")}
className="px-6 py-3 bg-[#1E3A8A] text-white rounded-lg hover:opacity-90"
>
Back to Home
</button>

</div>

</div>

);

}