// Evidence collection only. A page/iframe response never marks an asset healthy.
// Relevance, actual playback, metadata and accessibility require reviewed proof.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { videoCandidates } from '../curriculum/source/catalog.mjs';

const browser=await chromium.launch({headless:true});
const server=createServer((request,response)=>{
  const id=request.url?.slice(1);
  if(!videoCandidates.some(v=>v[0]===id)){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'strict-origin-when-cross-origin'});
  response.end(`<!doctype html><html><head><title>BTG video verification</title></head><body><iframe id="candidate" title="Candidate video" width="1200" height="675" src="https://www.youtube.com/embed/${id}" allow="autoplay; encrypted-media; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const records=[];
mkdirSync('test-results/video-verification',{recursive:true});
try {
  for(const [id,title] of videoCandidates){
    const record={video_id:id,candidate_title:title,checked_at:new Date().toISOString(),health_status:'needs_review',observations:[]};
    for(const [kind,url] of [['source',`https://www.youtube.com/watch?v=${id}`],['embed',`https://www.youtube.com/embed/${id}`]]){
      const page=await browser.newPage();
      try{
        const embedResponse=kind==='embed'?page.waitForResponse(r=>r.url().startsWith(url),{timeout:10000}).catch(()=>null):null;
        const documentResponse=await page.goto(kind==='embed'?`${origin}/${id}`:url,{waitUntil:'domcontentloaded',timeout:10000});
        const response=embedResponse?await embedResponse:documentResponse;
        const observation={kind,url,http_status:response?.status()??null,title:await page.title(),
          playback_verified:false,relevance_verified:false,metadata_verified:false};
        if(kind==='embed'){
          const frame=page.frameLocator('#candidate');
          try {
            await frame.getByRole('button',{name:/^play/i}).first().click({timeout:7000});
            await frame.locator('video').waitFor({state:'attached',timeout:7000});
            const mediaFrame=page.frames().find(f=>f.url().startsWith(url));
            await mediaFrame.waitForFunction(()=>{
              const media=document.querySelector('video');
              return media && media.currentTime>0 && !media.paused && media.readyState>=2;
            },{},{timeout:8000});
            observation.playback_verified=true;
            observation.observed_media=await frame.locator('video').evaluate(video=>({current_time:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null}));
          } catch(error) {
            observation.playback_error=String(error.message);
            observation.controls=await frame.locator('button,[role="button"]').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),title:node.getAttribute('title'),class_name:node.className}))).catch(()=>[]);
          }
          observation.visible_message=(await frame.locator('body').innerText({timeout:3000})).slice(0,800);
        }
        await page.screenshot({path:`test-results/video-verification/${id}-${kind}.png`,timeout:5000});
        observation.screenshot=`test-results/video-verification/${id}-${kind}.png`;
        record.observations.push(observation);
      }catch(error){record.observations.push({kind,url,error:String(error.message),playback_verified:false,relevance_verified:false});}
      finally{await page.close();}
    }
    records.push(record);
    console.log(`${id}: needs_review (page observations do not certify playback/relevance)`);
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
writeFileSync('curriculum/video-verification.json',JSON.stringify({method:'Playwright Chromium source pages and actual iframes hosted on a local HTTP origin with strict-origin-when-cross-origin referrer policy',
  limitation:'No candidate has a complete identity, playback, embedding, relevance, metadata and accessibility proof. Network errors do not establish that a video is dead.',records},null,2)+'\n');
