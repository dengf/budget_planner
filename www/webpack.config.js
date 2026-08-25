const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// Identifies this build, so a running page can tell whether it is the one
// currently deployed -- ported from mortgage_calculator's webpack config;
// see src/version-check.js for why GitHub Pages needs this.
function buildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return crypto.randomBytes(6).toString('hex');
  }
}

const BUILD_ID = buildId();

class EmitVersionPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('EmitVersionPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'EmitVersionPlugin', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          compilation.emitAsset(
            'version.json',
            new sources.RawSource(JSON.stringify({ buildId: BUILD_ID })),
          );
        },
      );
    });
  }
}

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    clean: true,
  },
  // wasm-pack's `--target web` output does its own fetch + instantiate of
  // the .wasm binary, so webpack's native wasm module linking must stay
  // off -- see mortgage_calculator's webpack.config.js for the exact
  // corruption this caused when it was on.
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: { loader: 'babel-loader', options: { presets: ['@babel/preset-env', '@babel/preset-react'] } },
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx', '.wasm'],
    alias: { pkg: path.resolve(__dirname, 'pkg') },
  },
  plugins: [
    new webpack.DefinePlugin({ __BUILD_ID__: JSON.stringify(BUILD_ID) }),
    new EmitVersionPlugin(),
    new HtmlWebpackPlugin({ template: './index.html', favicon: false }),
    new CopyWebpackPlugin({ patterns: [{ from: 'static', to: '.' }] }),
  ],
  devServer: {
    static: { directory: path.join(__dirname, 'dist') },
    compress: true,
    port: 3002,
    hot: true,
  },
  performance: { hints: false, maxEntrypointSize: 512000, maxAssetSize: 512000 },
};
