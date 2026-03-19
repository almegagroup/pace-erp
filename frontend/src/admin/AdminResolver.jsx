import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function AdminResolver(){

  const navigate = useNavigate();

  useEffect(()=>{

    let alive = true;

    async function resolve(){

      try{

        const res = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/me/menu`,
          { credentials:"include" }
        );

        if(!res.ok){
          throw new Error("MENU_FETCH_FAILED");
        }

        const data = await res.json();

        const menu = data?.data?.menu ?? [];

        /* Look for admin dashboard routes */

        const ga = menu.find(m=>m.screen_code === "GA_HOME")
        const sa = menu.find(m=>m.route_path === "/sa/home");

        if(!alive) return;

        if(ga){
          navigate("/ga/home",{replace:true});
          return;
        }

        if(sa){
          navigate("/sa/home",{replace:true});
          return;
        }

        /* fallback */

        navigate("/dashboard",{replace:true});

      }catch(err){

        navigate("/login",{replace:true});

      }

    }

    resolve();

    return ()=>{
      alive = false;
    };

  },[navigate]);

  return null;

}