export default function InstanceSwitcher({ instances, active, onChange }) {
  if (instances.length === 0) return null;
  return (
    <div className="flex rounded-sm overflow-hidden border border-gray-700">
      {instances.map(inst => (
        <button
          key={inst.id}
          onClick={() => onChange(inst.id)}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            active === inst.id
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-750'
          }`}
        >
          {inst.label}
        </button>
      ))}
    </div>
  );
}
