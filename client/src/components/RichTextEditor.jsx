import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

/** A dependency-light rich-text editor (Tiptap) for post bodies. Emits HTML. */
export function RichTextEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'rte-content min-h-[220px] rounded-b-xl border border-t-0 border-navy-800/15 bg-white px-4 py-3 text-sm outline-none focus:border-gold-500',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Sync when the parent swaps in a different post (guarded so typing never resets the caret).
  useEffect(() => {
    if (editor && value !== undefined && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', false);
    }
  }, [value, editor]);

  if (!editor) return null;

  const Btn = ({ on, active, label, title }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); on(); }}
      className={`rounded px-2 py-1 text-xs font-semibold transition ${
        active ? 'bg-navy-800 text-ivory' : 'text-ink-soft hover:bg-navy-800/10'
      }`}
    >
      {label}
    </button>
  );

  function addLink() {
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div>
      <style>{`
        .rte-content h2 { font-size:1.25rem; font-weight:700; margin:0.6em 0 0.3em; }
        .rte-content h3 { font-size:1.1rem; font-weight:700; margin:0.6em 0 0.3em; }
        .rte-content h4 { font-size:1rem; font-weight:700; margin:0.6em 0 0.3em; }
        .rte-content p { margin:0.4em 0; }
        .rte-content ul { list-style:disc; padding-left:1.4em; margin:0.4em 0; }
        .rte-content ol { list-style:decimal; padding-left:1.4em; margin:0.4em 0; }
        .rte-content a { color:#b8902d; text-decoration:underline; }
        .rte-content blockquote { border-left:3px solid #d4ac55; padding-left:0.8em; color:#555; margin:0.5em 0; }
        .rte-content:focus { outline:none; }
      `}</style>
      <div className="flex flex-wrap items-center gap-1 rounded-t-xl border border-navy-800/15 bg-ivory px-2 py-1.5">
        <Btn label="B" title="Bold" active={editor.isActive('bold')} on={() => editor.chain().focus().toggleBold().run()} />
        <Btn label="I" title="Italic" active={editor.isActive('italic')} on={() => editor.chain().focus().toggleItalic().run()} />
        <span className="mx-1 h-4 w-px bg-navy-800/15" />
        <Btn label="H2" title="Heading" active={editor.isActive('heading', { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Btn label="H3" title="Subheading" active={editor.isActive('heading', { level: 3 })} on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <span className="mx-1 h-4 w-px bg-navy-800/15" />
        <Btn label="• List" title="Bullet list" active={editor.isActive('bulletList')} on={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn label="1. List" title="Numbered list" active={editor.isActive('orderedList')} on={() => editor.chain().focus().toggleOrderedList().run()} />
        <Btn label="❝" title="Quote" active={editor.isActive('blockquote')} on={() => editor.chain().focus().toggleBlockquote().run()} />
        <Btn label="Link" title="Add link" active={editor.isActive('link')} on={addLink} />
        <span className="mx-1 h-4 w-px bg-navy-800/15" />
        <Btn label="↶" title="Undo" on={() => editor.chain().focus().undo().run()} />
        <Btn label="↷" title="Redo" on={() => editor.chain().focus().redo().run()} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
