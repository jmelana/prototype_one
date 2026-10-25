// ---- Country groups: built-in + user-defined -------------------------------
// Built-ins come from PREDEFINED_GROUPS and are read-only. Custom groups are
// persisted and get ids prefixed "custom:" so they can never collide with or
// overwrite a built-in.
const CountryGroups = (() => {
  const KEY = "customGroups";
  const builtins = PREDEFINED_GROUPS.map(g => Object.freeze({ ...g, members: Object.freeze([...g.members]), builtin: true }));

  function create(store = Store) {
    let custom = sanitize(store.get(KEY, []));
    const listeners = new Set();

    function sanitize(list) {
      if (!Array.isArray(list)) return [];
      return list
        .filter(g => g && typeof g.id === "string" && g.id.startsWith("custom:") && typeof g.name === "string" && Array.isArray(g.members))
        .map(g => ({ id: g.id, name: g.name, members: [...new Set(g.members.filter(c => /^[A-Z]{2}$/.test(c)))], builtin: false }));
    }
    function persist() {
      store.set(KEY, custom.map(({ id, name, members }) => ({ id, name, members })));
      listeners.forEach(fn => fn());
    }

    const all = () => [...builtins, ...custom];
    const get = id => all().find(g => g.id === id) || null;

    // Returns an error message, or "" when valid.
    function validate({ id, name, members }) {
      const n = (name || "").trim();
      if (!n) return "Give the group a name.";
      if (n.length > 40) return "Keep the name to 40 characters or fewer.";
      const clash = all().find(g => g.id !== id && g.name.toLowerCase() === n.toLowerCase());
      if (clash) return clash.builtin ? `“${clash.name}” is a built-in group name.` : `You already have a group called “${clash.name}”.`;
      if (!members || !members.length) return "Pick at least one country.";
      return "";
    }

    function save({ id, name, members }) {
      if (id && !id.startsWith("custom:")) throw new Error("Built-in groups can't be edited.");
      const err = validate({ id, name, members });
      if (err) throw new Error(err);
      const g = { id: id || "custom:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                  name: name.trim(), members: [...new Set(members)], builtin: false };
      const i = custom.findIndex(x => x.id === g.id);
      if (i >= 0) custom[i] = g; else custom.push(g);
      persist();
      return g;
    }

    function remove(id) {
      if (!id.startsWith("custom:")) throw new Error("Built-in groups can't be deleted.");
      custom = custom.filter(g => g.id !== id);
      persist();
    }

    return {
      all, get, validate, save, remove,
      builtins: () => builtins,
      custom: () => custom,
      onChange: fn => listeners.add(fn),
    };
  }

  return { create };
})();
