import "./globals.css";
import "./additions.css";
import "./public.css";
import "./effectivizacion.css";
import "./screen.css";
import "./preferential.css";
import type { Metadata, Viewport } from "next";
export const metadata: Metadata={
  title:"Turnos ATK",
  description:"Gestión de atención y turnos",
  applicationName:"Turnos ATK",
  manifest:"/manifest.webmanifest",
  appleWebApp:{capable:true,title:"Turnos ATK",statusBarStyle:"black-translucent"},
  icons:{
    icon:[{url:"/icons/turnos-192.png",sizes:"192x192",type:"image/png"},{url:"/icons/turnos-512.png",sizes:"512x512",type:"image/png"}],
    apple:[{url:"/icons/turnos-180.png",sizes:"180x180",type:"image/png"}],
  },
};
export const viewport: Viewport = { themeColor:"#0a1422" };
export default function Layout({children}:{children:React.ReactNode}){return <html lang="es"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/></head><body>{children}</body></html>;}
