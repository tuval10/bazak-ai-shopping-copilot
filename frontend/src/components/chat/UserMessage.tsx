/** A user's turn — right-aligned accent bubble echoing what they typed (US-1.1). */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-bazak text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[80%] whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  );
}
