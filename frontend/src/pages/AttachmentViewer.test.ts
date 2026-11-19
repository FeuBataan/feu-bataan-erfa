import { describe, expect, it } from 'vitest';
import { viewKind } from './AttachmentViewer';

describe('attachment viewer', () => {
  it('opens PDFs and pictures in eRFA and downloads Word files', () => {
    expect(viewKind({ FILE_NAME: 'Quotation.pdf', MIME_TYPE: 'application/pdf' })).toBe('pdf');
    expect(viewKind({ FILE_NAME: 'scan.PDF', MIME_TYPE: '' })).toBe('pdf');
    expect(viewKind({ FILE_NAME: 'photo.jpg', MIME_TYPE: 'image/jpeg' })).toBe('image');
    expect(viewKind({ FILE_NAME: 'receipt.png', MIME_TYPE: '' })).toBe('image');
    expect(viewKind({ FILE_NAME: 'letter.docx', MIME_TYPE: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('other');
    expect(viewKind({ FILE_NAME: 'old.doc', MIME_TYPE: 'application/msword' })).toBe('other');
  });
});
