import {createLibraryBackup, downloadFile, validateImport} from './output.js';

export const MAX_TRANSFER_BYTES = 250 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', {fatal:true});
const zipError = () => new Error('ZIP 백업을 읽을 수 없어요. 원래 백업 파일을 다시 선택하거나 ZIP 안의 library.json을 선택해 주세요.');

/** Counts for a concrete import/export review; this does not change storage. */
export function backupSummary(state) {
  return {
    bookCount:Array.isArray(state?.books)?state.books.length:0,
    characterCount:Array.isArray(state?.characters)?state.characters.length:0,
    backgroundCount:Array.isArray(state?.backgrounds)?state.backgrounds.length:0,
    worldCount:Array.isArray(state?.worlds)?state.worlds.length:0,
    draftCount:Object.values(state?.storyDrafts||{}).filter(draft=>draft?.id && draft.stage!=='final').length,
    imageCount:state?._restoreAssets?.length || 0,
    audioCount:state?._restoreAudioAssets?.length || 0
  };
}

/** A single file includes media bytes as well as all editable library data. */
export async function downloadLibraryTransfer(state) {
  const backup = await createLibraryBackup(state);
  downloadFile(backup.text, backup.filename, 'application/json;charset=utf-8');
  const {filename,bookCount,characterCount,backgroundCount,worldCount,imageCount,audioCount} = backup;
  return {filename,bookCount,characterCount,backgroundCount,worldCount,imageCount,audioCount};
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index=0;index<256;index++) {
    let value=index;
    for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;
    table[index]=value>>>0;
  }
  return table;
})();
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function readName(bytes) {
  let name;
  try{name=decoder.decode(bytes);}catch{throw zipError();}
  if(!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(part=>part==='..'))throw zipError();
  return name;
}

async function inflateRaw(bytes, expectedSize) {
  if(!globalThis.DecompressionStream)throw new Error('이 브라우저에서는 압축된 ZIP을 바로 열 수 없어요. ZIP을 풀고 library.json을 선택해 주세요.');
  let stream;
  try{stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}
  catch{throw new Error('이 브라우저에서는 압축된 ZIP을 바로 열 수 없어요. ZIP을 풀고 library.json을 선택해 주세요.');}
  const reader=stream.getReader(),chunks=[];let size=0;
  try {
    for(;;){
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>expectedSize || size>MAX_TRANSFER_BYTES){await reader.cancel();throw zipError();}
      chunks.push(value);
    }
  }catch{throw zipError();}
  if(size!==expectedSize)throw zipError();
  const result=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  return result;
}

/** Read one entry in memory. No archive paths are extracted to the filesystem. */
async function zipLibrary(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){
    if(view.getUint32(at,true)===0x06054b50 && at+22+view.getUint16(at+20,true)===bytes.length){end=at;break;}
  }
  if(end<0 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0)throw zipError();
  const entries=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true);
  if(!entries || entries===0xffff || view.getUint16(end+8,true)!==entries || directorySize===0xffffffff || directoryOffset===0xffffffff || directoryOffset+directorySize!==end)throw zipError();
  let cursor=directoryOffset,selected=null;
  for(let index=0;index<entries;index++){
    if(cursor+46>end || view.getUint32(cursor,true)!==0x02014b50)throw zipError();
    const nameSize=view.getUint16(cursor+28,true),extraSize=view.getUint16(cursor+30,true),commentSize=view.getUint16(cursor+32,true);
    const next=cursor+46+nameSize+extraSize+commentSize;
    if(next>end || view.getUint16(cursor+34,true)!==0)throw zipError();
    const name=readName(bytes.subarray(cursor+46,cursor+46+nameSize));
    if(name==='library.json'){
      if(selected)throw new Error('library.json이 두 개 있는 ZIP은 복원할 수 없어요. 원래 백업 파일을 선택해 주세요.');
      selected={name,flags:view.getUint16(cursor+8,true),method:view.getUint16(cursor+10,true),crc:view.getUint32(cursor+16,true),compressedSize:view.getUint32(cursor+20,true),size:view.getUint32(cursor+24,true),offset:view.getUint32(cursor+42,true)};
    }
    cursor=next;
  }
  if(cursor!==end || !selected)throw zipError();
  const {flags,method,crc,compressedSize,size,offset}=selected;
  if(flags&1 || ![0,8].includes(method) || !size || size>MAX_TRANSFER_BYTES || compressedSize>MAX_TRANSFER_BYTES || offset+30>directoryOffset)throw zipError();
  if(view.getUint32(offset,true)!==0x04034b50 || view.getUint16(offset+6,true)!==flags || view.getUint16(offset+8,true)!==method)throw zipError();
  const nameSize=view.getUint16(offset+26,true),extraSize=view.getUint16(offset+28,true),start=offset+30+nameSize+extraSize;
  if(start>directoryOffset || start+compressedSize>directoryOffset || readName(bytes.subarray(offset+30,offset+30+nameSize))!=='library.json')throw zipError();
  if(!(flags&8) && (view.getUint32(offset+14,true)!==crc || view.getUint32(offset+18,true)!==compressedSize || view.getUint32(offset+22,true)!==size))throw zipError();
  let content=bytes.subarray(start,start+compressedSize);
  if(method===8)content=await inflateRaw(content,size);
  if(content.byteLength!==size || crc32(content)!==crc)throw new Error('백업 파일의 내용이 손상되었어요. 원래 기기에서 다시 내보낸 파일을 선택해 주세요.');
  return content;
}

/** Returns a checked state with restore manifests; never writes local data. */
export async function readLibraryBackupFile(file) {
  if(!file || typeof file.arrayBuffer!=='function' || !Number.isFinite(file.size) || file.size<=0 || file.size>MAX_TRANSFER_BYTES)throw new Error('250MB 이하의 동화공방 JSON 또는 ZIP 백업 파일을 선택해 주세요.');
  let bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.byteLength>MAX_TRANSFER_BYTES || bytes.byteLength!==file.size)throw new Error('백업 파일의 크기를 확인해 주세요.');
  if(bytes.length>=4 && bytes[0]===0x50 && bytes[1]===0x4b)bytes=await zipLibrary(bytes);
  let text;
  try{text=decoder.decode(bytes).replace(/^\uFEFF/,'');}catch{throw new Error('백업 파일의 문자 인코딩을 읽을 수 없어요. UTF-8 JSON 백업을 선택해 주세요.');}
  return validateImport(text);
}
