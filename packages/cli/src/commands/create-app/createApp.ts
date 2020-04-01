/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import chalk from 'chalk';
import inquirer, { Answers, Question } from 'inquirer';
import { exec as execCb } from 'child_process';
import { resolve as resolvePath } from 'path';
import { realpathSync } from 'fs';
import os from 'os';
import { Task, templatingTask } from '../../helpers/tasks';
const exec = promisify(execCb);

async function checkExists(rootDir: string, name: string) {
  await Task.forItem('checking', name, async () => {
    const destination = path.join(rootDir, 'plugins', name);

    if (await fs.pathExists(destination)) {
      const existing = chalk.cyan(destination.replace(`${rootDir}/`, ''));
      throw new Error(
        `A directory with the same name already exists: ${existing}\nPlease try again with a different app name`,
      );
    }
  });
}

export async function createTemporaryAppFolder(tempDir: string) {
  await Task.forItem('creating', 'temporary directory', async () => {
    try {
      await fs.mkdir(tempDir);
    } catch (error) {
      throw new Error(
        `Failed to create temporary app directory: ${error.message}`,
      );
    }
  });
}

async function cleanUp(tempDir: string) {
  await Task.forItem('remove', 'temporary directory', async () => {
    await fs.remove(tempDir);
  });
}

async function buildApp(pluginFolder: string) {
  const commands = ['yarn install', 'yarn build'];
  for (const command of commands) {
    await Task.forItem('executing', command, async () => {
      process.chdir(pluginFolder);

      await exec(command).catch(error => {
        process.stdout.write(error.stderr);
        process.stdout.write(error.stdout);
        throw new Error(`Could not execute command ${chalk.cyan(command)}`);
      });
    });
  }
}

export async function moveApp(
  tempDir: string,
  destination: string,
  id: string,
) {
  await Task.forItem('moving', id, async () => {
    await fs.move(tempDir, destination).catch(error => {
      throw new Error(
        `Failed to move plugin from ${tempDir} to ${destination}: ${error.message}`,
      );
    });
  });
}

export default async () => {
  const questions: Question[] = [
    {
      type: 'input',
      name: 'name',
      message: chalk.blue('Enter a name for the app [required]'),
      validate: (value: any) => {
        if (!value) {
          return chalk.red('Please enter a name for the app');
        } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
          return chalk.red(
            'Plugin name must be kebab-cased and contain only letters, digits, and dashes.',
          );
        }
        return true;
      },
    },
  ];
  const answers: Answers = await inquirer.prompt(questions);

  const rootDir = realpathSync(process.cwd());
  const cliPackage = resolvePath(__dirname, '../../..');
  const templateDir = resolvePath(cliPackage, 'templates', 'default-app');
  const tempDir = path.join(os.tmpdir(), answers.name);
  const appDir = path.join(rootDir, answers.name);
  const version = require(resolvePath(cliPackage, 'package.json')).version;

  Task.log();
  Task.log('Creating the app...');

  try {
    Task.section('Checking if the directory is available');
    await checkExists(rootDir, answers.name);

    Task.section('Creating a temporary app directory');
    await createTemporaryAppFolder(tempDir);

    Task.section('Preparing files');
    await templatingTask(templateDir, tempDir, { ...answers, version });

    Task.section('Moving to final location');
    await moveApp(tempDir, appDir, answers.name);

    Task.section('Building the app');
    await buildApp(appDir);

    Task.log();
    Task.log(
      chalk.green(`🥇  Successfully created ${chalk.cyan(answers.name)}`),
    );
    Task.log();
  } catch (error) {
    Task.error(error.message);

    Task.log('It seems that something went wrong when creating the app 🤔');
    Task.log('We are going to clean up, and then you can try again.');

    Task.section('Cleanup');
    await cleanUp(tempDir);
    Task.error('🔥  Failed to create app!');
  }
};