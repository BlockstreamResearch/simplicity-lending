use simplex::program::Program;

/// Writes `slots` into the storage of `program`, starting at the first slot.
pub(crate) fn set_storage_slots(program: &mut impl AsMut<Program>, slots: &[[u8; 32]]) {
    for (index, slot) in slots.iter().enumerate() {
        program.as_mut().set_storage_at(index, *slot);
    }
}
