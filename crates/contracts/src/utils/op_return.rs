use simplex::simplicityhl::elements::{Script, opcodes, script::Instruction};

pub fn op_return_payload(script: &Script) -> Option<&[u8]> {
    let mut instructions = script.instructions_minimal();

    match instructions.next()? {
        Ok(Instruction::Op(opcodes::all::OP_RETURN)) => {}
        _ => return None,
    }

    instructions.next()?.ok()?.push_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    const OP_RETURN_BYTE: u8 = 0x6a;
    const OP_DUP_BYTE: u8 = 0x76;

    #[test]
    fn returns_payload_for_op_return_script() {
        let payload: &[u8] = b"hello";
        let script = Script::new_op_return(payload);

        assert_eq!(op_return_payload(&script), Some(payload));
    }

    #[test]
    fn returns_empty_payload_for_op_return_with_no_data() {
        let script = Script::new_op_return(&[]);

        assert_eq!(op_return_payload(&script), Some(&[][..]));
    }

    #[test]
    fn returns_none_for_empty_script() {
        let script = Script::new();

        assert_eq!(op_return_payload(&script), None);
    }

    #[test]
    fn returns_none_when_first_opcode_is_not_op_return() {
        let script = Script::from(vec![OP_DUP_BYTE]);

        assert_eq!(op_return_payload(&script), None);
    }

    #[test]
    fn returns_none_when_op_return_is_not_followed_by_a_push() {
        let script = Script::from(vec![OP_RETURN_BYTE, OP_DUP_BYTE]);

        assert_eq!(op_return_payload(&script), None);
    }

    #[test]
    fn returns_none_when_only_op_return_is_present() {
        let script = Script::from(vec![OP_RETURN_BYTE]);

        assert_eq!(op_return_payload(&script), None);
    }
}
