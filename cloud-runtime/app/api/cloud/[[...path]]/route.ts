import {env} from 'cloudflare:workers';
import {handleCloudRequest} from '../../../../../server/cloud-api.js';
export const dynamic='force-dynamic';
async function handle(request:Request){return await handleCloudRequest(request,env)||new Response('Not found',{status:404})}
export const GET=handle;export const PUT=handle;export const POST=handle;export const DELETE=handle;export const OPTIONS=handle;
