//! Pure in-memory buffer logic backing [`crate::wasm`]'s
//! `redb::StorageBackend` implementation. Pulled out of that (wasm32-only)
//! module so this -- including the offset-overflow guards -- can be
//! unit-tested with a plain `cargo test`, without needing a wasm32 target
//! or a browser to run in. Ported unchanged from mortgage_calculator's
//! `mortgage-ext-redb`: this logic has no schema, so nothing about a
//! second app's record types changes it.

use std::io;

#[derive(Debug, Default)]
pub(crate) struct InMemoryBuffer {
    bytes: Vec<u8>,
}

impl InMemoryBuffer {
    pub(crate) fn new(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }

    pub(crate) fn len(&self) -> u64 {
        self.bytes.len() as u64
    }

    pub(crate) fn read(&self, offset: u64, out: &mut [u8]) -> io::Result<()> {
        let start = offset as usize;
        let end = start
            .checked_add(out.len())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "offset overflow"))?;
        if end > self.bytes.len() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "read past end of in-memory database",
            ));
        }
        out.copy_from_slice(&self.bytes[start..end]);
        Ok(())
    }

    pub(crate) fn write(&mut self, offset: u64, data: &[u8]) -> io::Result<()> {
        let start = offset as usize;
        let end = start
            .checked_add(data.len())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "offset overflow"))?;
        if end > self.bytes.len() {
            self.bytes.resize(end, 0);
        }
        self.bytes[start..end].copy_from_slice(data);
        Ok(())
    }

    pub(crate) fn set_len(&mut self, len: u64) {
        self.bytes.resize(len as usize, 0);
    }

    pub(crate) fn snapshot(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_returns_the_bytes_written_at_that_offset() {
        let mut buf = InMemoryBuffer::new(Vec::new());
        buf.write(0, b"hello").unwrap();
        buf.write(5, b" world").unwrap();

        let mut out = [0u8; 11];
        buf.read(0, &mut out).unwrap();
        assert_eq!(&out, b"hello world");
    }

    #[test]
    fn write_grows_the_buffer_and_zero_fills_any_gap() {
        let mut buf = InMemoryBuffer::new(Vec::new());
        buf.write(4, b"end").unwrap();

        assert_eq!(buf.len(), 7);
        let mut out = [0u8; 7];
        buf.read(0, &mut out).unwrap();
        assert_eq!(&out, b"\0\0\0\0end");
    }

    #[test]
    fn read_past_the_end_of_the_buffer_errors_instead_of_panicking() {
        let buf = InMemoryBuffer::new(vec![1, 2, 3]);
        let mut out = [0u8; 4];
        let err = buf.read(0, &mut out).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn read_offset_overflow_errors_instead_of_wrapping() {
        let buf = InMemoryBuffer::new(vec![1, 2, 3]);
        let mut out = [0u8; 4];
        let err = buf.read(u64::MAX, &mut out).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn write_offset_overflow_errors_instead_of_panicking() {
        let mut buf = InMemoryBuffer::new(vec![1, 2, 3]);
        let err = buf.write(u64::MAX, b"x").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn set_len_truncates_and_zero_extends() {
        let mut buf = InMemoryBuffer::new(vec![1, 2, 3, 4, 5]);
        buf.set_len(2);
        assert_eq!(buf.snapshot(), vec![1, 2]);

        buf.set_len(4);
        assert_eq!(buf.snapshot(), vec![1, 2, 0, 0]);
    }

    #[test]
    fn snapshot_is_independent_of_later_writes() {
        let mut buf = InMemoryBuffer::new(vec![1, 2, 3]);
        let snap = buf.snapshot();
        buf.write(0, b"\xff").unwrap();
        assert_eq!(snap, vec![1, 2, 3]);
    }
}
