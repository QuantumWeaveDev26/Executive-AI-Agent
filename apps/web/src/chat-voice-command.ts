/** An interrupted run needs verified terminal state before another automatic voice command. */
export async function confirmVoiceCancellation(voice:AbortSignal,transport:AbortSignal,streamId:string|undefined,cancel:(id:string)=>Promise<{success:boolean;status:string}>){
 if(!voice.aborted&&!transport.aborted)return;
 if(!streamId)throw Error('Could not confirm the interrupted request. Automatic voice commands stopped.');
 const receipt=await cancel(streamId);
 if(!receipt.success||!['cancelled','completed','failed','not_configured'].includes(receipt.status))throw Error('Interrupted request is not confirmed stopped.');
}
