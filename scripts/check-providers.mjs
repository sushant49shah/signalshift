// Read-only connectivity check. No voice, room creation, or billable inference.
import { RoomServiceClient } from 'livekit-server-sdk';
try {process.loadEnvFile('.env.local');} catch {}
const needed=['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','DETECTIF_API_KEY'];
if(needed.some(k=>!process.env[k])){console.log('Provider configuration incomplete.');process.exitCode=1;}
else{
  try{const rooms=new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^ws/,'http'),process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
    await rooms.listRooms();console.log('LiveKit: authenticated room-service connection succeeded.');
  }catch{console.log('LiveKit: connection/authentication failed. Check project URL and matching credentials.');process.exitCode=1;}
  try{const r=await fetch('https://platform.detectif.ai/v1/credits',{headers:{Authorization:`Bearer ${process.env.DETECTIF_API_KEY}`},signal:AbortSignal.timeout(15000)});
    console.log(r.ok?'DetectifAI: authenticated account request succeeded (no audio submitted).':`DetectifAI: account request returned HTTP ${r.status}. A scope or configuration check may be needed.`);
    if(!r.ok)process.exitCode=1;
  }catch{console.log('DetectifAI: connection failed or timed out.');process.exitCode=1;}
}
