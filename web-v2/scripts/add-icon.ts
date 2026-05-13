/* eslint-disable no-console */
import chalk from 'chalk'
import { exec } from 'child_process'
import clipboardy from 'clipboardy'
import fs from 'fs'

const USAGE = `
Usage:
${chalk.gray(`node scripts/add-icon.mjs ${chalk.blue('<icon-name>')} ${chalk.yellow('[icon-content]')}`)}

Example:
${chalk.gray("node scripts/add-icon.mjs moon-filled '<svg>...</svg>'")}

This script creates a new icon component in the ${chalk.gray('src/components/icons')} directory.
The icon name should be a valid identifier (no spaces, special characters).

${chalk.yellow('Note: If no icon content is provided, it will read from the clipboard.')}
`

async function main() {
  try {
    const { name, content } = await getIconOptions()
    const filePath = await createIconComponent({ name, content })
    // run eslint to format the file
    await runEslint(filePath)
    console.info('Icon component created:', chalk.blue(filePath))
  } catch (error) {
    console.error('Error when creating icon component:', chalk.red(error))
    process.exit(1)
  }
}

async function getIconOptions() {
  const iconName = process.argv[2]
  if (!iconName) {
    handleValidationError('Please provide an icon name as the first argument.')
  }

  if (iconName.length > 64) {
    handleValidationError('Icon name is too long. Please use a shorter name (max 64 characters).')
  }

  if (!/^[a-zA-Z0-9-]*$/.test(iconName)) {
    handleValidationError(
      'Icon name contains invalid characters. Please use only alphanumeric characters and hyphens.',
    )
  }

  let iconContent = process.argv[3]
  if (!iconContent) {
    console.warn(
      chalk.gray('No icon content provided as the second argument.\nReading from clipboard...'),
    )
    iconContent = await clipboardy.read()
  }

  if (!/<svg[^>]*>/i.test(iconContent)) {
    handleValidationError(
      'Icon content does not appear to be a valid SVG.\nPlease provide a valid SVG content as the second argument.',
    )
  }

  return {
    name: iconName,
    content: iconContent,
  }
}

async function createIconComponent({ name, content }: { name: string; content: string }) {
  const fileName = name.toLowerCase().replace(/ /g, '-') + '-icon'
  const filePath = `./src/components/icons/${fileName}.tsx`

  // Check if the file already exists
  if (fs.existsSync(filePath)) {
    console.error(chalk.red(`File ${filePath} already exists. Please choose a different name.`))
    process.exit(1)
  }

  // Use PascalCase for the component name
  const componentName = fileName.replace(/(^\w|-\w)/g, c => c.toUpperCase()).replace(/-/g, '')

  const fileContent = `
import type { SVGProps } from "react"

export default function ${componentName}(props: SVGProps<SVGSVGElement>) {
  return (
    ${normalizeSvgContent(content).trim()}
  )
}
`

  await fs.promises.writeFile(filePath, fileContent.trim(), 'utf8')
  return filePath
}

function normalizeSvgContent(svgContent: string) {
  return (
    svgContent
      // remove width, height, and fill attributes
      .replace(/<svg[^>]*>/, match =>
        match
          .replace(/width="[^"]*"/, '')
          .replace(/height="[^"]*"/, '')
          .replace(/fill="[^"]*"/, ''),
      )
      // use currentColor for fill and stroke
      .replace(/fill="[^"]*"/g, 'fill="currentColor"')
      .replace(/stroke="[^"]*"/g, 'stroke="currentColor"')
      // add other attributes to <svg> tag
      .replace(/<svg/, '<svg fill="none" role="presentation" focusable="false" aria-hidden="true"')
      // add rest props to the end of <svg> tag attributes
      .replace(/<svg([^>]*)>/, '<svg$1 {...props}>')
  )
}

function runEslint(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    exec(`npx eslint --fix ${filePath}`, error => {
      if (error) {
        console.error(chalk.red(`Error running ESLint on ${filePath}: ${error.message}`))
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

function handleValidationError(message: string) {
  console.error(chalk.red(message))
  console.info(USAGE)
  process.exit(1)
}

main()
