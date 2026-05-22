import { sources } from 'virtual:simplicity-sources'

export default function CovenantDemo() {
  return (
    <div>
      CovenantDemo
      <div className='mt-2 rounded border border-gray-300 bg-white p-4 overflow-x-auto'>
        <pre className='mt-4 rounded bg-gray-100 p-4 text-sm'>
          {JSON.stringify(sources, null, 2)}
        </pre>
      </div>
    </div>
  )
}
