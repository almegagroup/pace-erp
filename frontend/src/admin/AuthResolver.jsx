/*
 * File-ID: 7.X (UPDATED)
 * File-Path: frontend/src/admin/AuthResolver.jsx
 * Purpose: Redirect user based on already available menu snapshot
 * Authority: Frontend (NO API CALL)
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";

export default function AuthResolver(){

  const navigate = useNavigate();
  const { menu } = useMenu();

  useEffect(() => {

    // ⛔ menu এখনও load না হলে কিছু করো না
    if (!menu || menu.length === 0) return;

    const ga = menu.find(m => m.menu_code === "GA_HOME");
    const sa = menu.find(m => m.menu_code === "SA_HOME");

    if (ga) {
      navigate("/ga/home", { replace: true });
      return;
    }

    if (sa) {
      navigate("/sa/home", { replace: true });
      return;
    }

    navigate("/dashboard", { replace: true });

  }, [menu, navigate]);

  return (
    <div style={{
      padding:"20px",
      textAlign:"center",
      fontSize:"14px",
      color:"#555"
    }}>
      Redirecting...
    </div>
  );
}