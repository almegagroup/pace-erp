import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMenu } from "../context/useMenu.js";

export default function AuthResolver(){

  const navigate = useNavigate();
  const { setMenuSnapshot } = useMenu();

  useEffect(()=>{

    let alive = true;

    async function resolve(){

      try{

        const meRes = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me`,
          { credentials: "include" }
        );

        if(!meRes.ok){
          throw new Error("SESSION_INVALID");
        }

        const menuRes = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me/menu`,
          { credentials: "include" }
        );

        if(!menuRes.ok){
          throw new Error("MENU_FETCH_FAILED");
        }

        const data = await menuRes.json();
        if(!alive) return;

        const menu = data?.data?.menu ?? [];

        setMenuSnapshot(menu);

        const ga = menu.find(m => m.menu_code === "GA_HOME");
        const sa = menu.find(m => m.menu_code === "SA_HOME");

        if(ga){
          navigate("/ga/home",{replace:true});
          return;
        }

        if(sa){
          navigate("/sa/home",{replace:true});
          return;
        }

        navigate("/dashboard",{replace:true});

      }catch(_err){
        console.error("AuthResolver failed:", _err); // ✅ added
        navigate("/login",{replace:true});
      }

    }

    resolve();

    return ()=>{ alive = false };

  }, [navigate, setMenuSnapshot]);

  return (
    <div style={{
      padding:"20px",
      textAlign:"center",
      fontSize:"14px",
      color:"#555"
    }}>
      Verifying session...
    </div>
  );
}